/*
 * MX Bikes Manager presence plugin (mxbm_presence.dlo)
 *
 * Uses PiBoSo's official plugin interface. It only listens: when you enter an event it writes
 * what the game reports (server name, track, your bike, riders on the server) to
 *   <MX Bikes user folder>\mxbm_presence.json
 * which MX Bikes Manager reads. It draws nothing, changes nothing in the game and opens no network
 * connections.
 *
 * Build (64-bit DLL, renamed to .dlo):
 *   zig cc -target x86_64-windows-gnu -shared -O2 -o mxbm_presence.dlo mxbm_presence.c
 *   x86_64-w64-mingw32-gcc -shared -O2 -s -o mxbm_presence.dlo mxbm_presence.c
 *   cl /LD /O2 mxbm_presence.c /Fe:mxbm_presence.dlo
 */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h> /* types only; socket functions are looked up at runtime */
#include <ws2tcpip.h>
#include <windows.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#define EXPORT __declspec(dllexport)
#define MAX_RIDERS 128
#define OUT_CAP (64 * 1024)

/* --- the parts of PiBoSo's structures this plugin reads (interface 9 / data 8) --- */
typedef struct {
  char m_szRiderName[100];
  char m_szBikeID[100];
  char m_szBikeName[100];
  int m_iNumberOfGears, m_iMaxRPM, m_iLimiter, m_iShiftRPM;
  float m_fEngineOptTemperature, m_afEngineTemperatureAlarm[2], m_fMaxFuel, m_afSuspMaxTravel[2], m_fSteerLock;
  char m_szCategory[100];
  char m_szTrackID[100];
  char m_szTrackName[100];
  float m_fTrackLength;
  int m_iType;               /* 1 = testing; 2 = race; 4 = straight rhythm */
  char m_szServerName[64];   /* newer game versions only: check the data size */
  int m_iServerType;
  char m_szGUID[100];
} BikeEvent;

typedef struct { int m_iType; char m_szName[100]; char m_szTrackName[100]; float m_fTrackLength; } RaceEventData;
typedef struct { int m_iRaceNum; char m_szName[100]; char m_szBikeName[100]; char m_szBikeShortName[100]; char m_szCategory[100]; int m_iUnactive; } RaceEntry;
typedef struct { int m_iRaceNum; } RaceRemove;
typedef struct { int m_iSession; int m_iSessionState; } RaceSessionData;

typedef struct { int used, num; char name[100], bike[100], category[100]; } Rider;

static void hookStart(const char *dir);
static void hookStop(void);
static int connectedServer(char *name, size_t ncap, char *addr, size_t acap);
static int ownRaceNumber(void);
static void stunStart(unsigned char *base);
static void stunStop(void);
static void stunUnhook(void);

static char g_path[MAX_PATH * 2];
static char g_tmp[MAX_PATH * 2];
static CRITICAL_SECTION g_lock;
static int g_lockReady;

static struct {
  int inEvent, type, serverType, session, haveServer;
  int onTrack; /* between RunInit (left the pits) and RunDeinit (back in the pits) */
  char rider[100], bikeId[100], bikeName[100], category[100], trackId[100], trackName[100], server[64], guid[100], eventName[100];
  Rider riders[MAX_RIDERS];
} S;

static void copy(char *dst, const char *src, size_t cap) {
  size_t i = 0;
  for (; i + 1 < cap && src[i]; i++) dst[i] = src[i];
  dst[i] = 0;
}

/* JSON string: escapes quotes, backslashes and control characters; keeps Latin-1 bytes as \u00XX. */
static size_t jstr(char *o, size_t at, const char *s, size_t cap) {
  if (at < cap) o[at++] = '"';
  for (; *s && at + 8 < cap; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { o[at++] = '\\'; o[at++] = (char)c; }
    else if (c < 0x20 || c >= 0x7f) at += (size_t)sprintf(o + at, "\\u%04x", c);
    else o[at++] = (char)c;
  }
  if (at < cap) o[at++] = '"';
  return at;
}

#define PUT(lit) do { size_t _n = sizeof(lit) - 1; if (at + _n < OUT_CAP) { memcpy(o + at, lit, _n); at += _n; } } while (0)
#define PUTS(key, val) do { PUT(",\"" key "\":"); at = jstr(o, at, (val), OUT_CAP); } while (0)
#define PUTI(key, val) do { if (at + 40 < OUT_CAP) at += (size_t)sprintf(o + at, ",\"" key "\":%d", (int)(val)); } while (0)

static void writeState(void) {
  static char o[OUT_CAP];
  size_t at = 0;
  FILETIME ft; ULARGE_INTEGER t;
  if (!g_path[0]) return;
  GetSystemTimeAsFileTime(&ft);
  t.LowPart = ft.dwLowDateTime; t.HighPart = ft.dwHighDateTime;
  at += (size_t)sprintf(o, "{\"v\":2,\"pid\":%lu,\"updated\":%llu", GetCurrentProcessId(), (t.QuadPart - 116444736000000000ULL) / 10000ULL);
  PUTI("inEvent", S.inEvent);
  if (S.inEvent) {
    PUTI("type", S.type);
    PUTI("session", S.session);
    PUTS("rider", S.rider);
    { int num = ownRaceNumber(); if (num > 0) PUTI("raceNumber", num); }
    PUTS("bikeId", S.bikeId);
    PUTS("bikeName", S.bikeName);
    PUTS("category", S.category);
    PUTS("trackId", S.trackId);
    PUTS("trackName", S.trackName);
    PUTS("eventName", S.eventName);
    if (S.haveServer) { PUTI("serverType", S.serverType); PUTS("guid", S.guid); }
    {
      /* The game only puts the server name in the on-track event; in the pits or while a race runs
       * the plugin reads the connected server's name and exact address from the game instead. */
      char ms[64], ma[32]; int mem = connectedServer(ms, sizeof ms, ma, sizeof ma);
      if (S.server[0]) PUTS("server", S.server); else if (mem) PUTS("server", ms);
      else if (S.haveServer) PUTS("server", S.server);
      if (mem && (!S.server[0] || _stricmp(S.server, ms) == 0)) PUTS("serverAddress", ma);
    }
    PUT(",\"riders\":[");
    {
      int first = 1, i;
      for (i = 0; i < MAX_RIDERS; i++) {
        if (!S.riders[i].used) continue;
        if (!first) PUT(",");
        first = 0;
        if (at + 20 < OUT_CAP) at += (size_t)sprintf(o + at, "{\"num\":%d,\"name\":", S.riders[i].num);
        at = jstr(o, at, S.riders[i].name, OUT_CAP);
        PUT(",\"bike\":"); at = jstr(o, at, S.riders[i].bike, OUT_CAP);
        PUT(",\"category\":"); at = jstr(o, at, S.riders[i].category, OUT_CAP);
        PUT("}");
      }
    }
    PUT("]");
  }
  PUT("}\n");

  /* Write a temp file, then swap it in, so the app never reads half a file. */
  {
    HANDLE h = CreateFileA(g_tmp, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    DWORD wrote = 0;
    if (h == INVALID_HANDLE_VALUE) return;
    WriteFile(h, o, (DWORD)at, &wrote, NULL);
    CloseHandle(h);
    if (wrote == at) MoveFileExA(g_tmp, g_path, MOVEFILE_REPLACE_EXISTING);
  }
}

static void lock(void) { if (g_lockReady) EnterCriticalSection(&g_lock); }
static void unlock(void) { if (g_lockReady) LeaveCriticalSection(&g_lock); }

EXPORT char *GetModID(void) { return "mxbikes"; }
EXPORT int GetModDataVersion(void) { return 8; }
EXPORT int GetInterfaceVersion(void) { return 9; }

/* _szSavePath is the game's user folder (Documents\PiBoSo\MX Bikes\).
 * Startup -1 disables the plugin, including event delivery. Request the lowest
 * supported rate (3 = 10 Hz); RunTelemetry intentionally ignores the payload. */
EXPORT int Startup(char *_szSavePath) {
  size_t n;
  InitializeCriticalSection(&g_lock); g_lockReady = 1;
  copy(g_path, _szSavePath ? _szSavePath : "", sizeof g_path - 40);
  n = strlen(g_path);
  if (n && g_path[n - 1] != '\\' && g_path[n - 1] != '/') g_path[n++] = '\\', g_path[n] = 0;
  hookStart(g_path);
  strcpy(g_tmp, g_path); strcat(g_tmp, "mxbm_presence.tmp");
  strcat(g_path, "mxbm_presence.json");
  memset(&S, 0, sizeof S);
  writeState();
  return 3;
}

EXPORT void RunTelemetry(void *_pData, int _iDataSize, float _fTime, float _fPos) {
  (void)_pData; (void)_iDataSize; (void)_fTime; (void)_fPos;
}

EXPORT void Shutdown(void) {
  hookStop();
  lock(); memset(&S, 0, sizeof S); writeState(); unlock();
  if (g_lockReady) { g_lockReady = 0; DeleteCriticalSection(&g_lock); }
}

EXPORT void EventInit(void *_pData, int _iDataSize) {
  const BikeEvent *e = (const BikeEvent *)_pData;
  if (!e || _iDataSize < (int)offsetof(BikeEvent, m_szServerName)) return;
  lock();
  S.inEvent = 1;
  copy(S.rider, e->m_szRiderName, sizeof S.rider);
  copy(S.bikeId, e->m_szBikeID, sizeof S.bikeId);
  copy(S.bikeName, e->m_szBikeName, sizeof S.bikeName);
  copy(S.category, e->m_szCategory, sizeof S.category);
  copy(S.trackId, e->m_szTrackID, sizeof S.trackId);
  copy(S.trackName, e->m_szTrackName, sizeof S.trackName);
  S.type = e->m_iType;
  S.haveServer = _iDataSize >= (int)(offsetof(BikeEvent, m_szServerName) + sizeof e->m_szServerName);
  S.server[0] = 0; S.guid[0] = 0; S.serverType = 0;
  if (S.haveServer) {
    copy(S.server, e->m_szServerName, sizeof S.server);
  }
  if (_iDataSize >= (int)(offsetof(BikeEvent, m_iServerType) + sizeof e->m_iServerType)) {
    S.serverType = e->m_iServerType;
  }
  if (_iDataSize >= (int)(offsetof(BikeEvent, m_szGUID) + sizeof e->m_szGUID)) copy(S.guid, e->m_szGUID, sizeof S.guid);
  writeState();
  unlock();
}

EXPORT void EventDeinit(void) { lock(); memset(&S, 0, sizeof S); writeState(); unlock(); }

EXPORT void RaceEvent(void *_pData, int _iDataSize) {
  const RaceEventData *e = (const RaceEventData *)_pData;
  if (!e || _iDataSize < (int)sizeof(RaceEventData) - (int)sizeof(float)) return;
  lock();
  /* RaceEvent arrives in the pits/spectator view too, before a local bike run.
   * Loaded replays are not live sessions and must not advertise an old server. */
  if (e->m_iType == -1) memset(&S, 0, sizeof S);
  else { S.inEvent = 1; S.type = e->m_iType; }
  copy(S.eventName, e->m_szName, sizeof S.eventName);
  if (!S.trackName[0]) copy(S.trackName, e->m_szTrackName, sizeof S.trackName);
  writeState();
  unlock();
}

/* Leaving the pits onto the track, and back. */
EXPORT void RunInit(void *_pData, int _iDataSize) { (void)_pData; (void)_iDataSize; S.onTrack = 1; }
EXPORT void RunDeinit(void) { S.onTrack = 0; }

EXPORT void RaceDeinit(void) { lock(); memset(&S, 0, sizeof S); writeState(); unlock(); }

EXPORT void RaceAddEntry(void *_pData, int _iDataSize) {
  const RaceEntry *e = (const RaceEntry *)_pData;
  int i, slot = -1;
  if (!e || _iDataSize < (int)offsetof(RaceEntry, m_iUnactive)) return;
  lock();
  for (i = 0; i < MAX_RIDERS; i++) if (S.riders[i].used && S.riders[i].num == e->m_iRaceNum) { slot = i; break; }
  if (slot < 0) for (i = 0; i < MAX_RIDERS; i++) if (!S.riders[i].used) { slot = i; break; }
  if (slot >= 0) {
    if (_iDataSize >= (int)sizeof(RaceEntry) && e->m_iUnactive) S.riders[slot].used = 0;
    else {
      S.riders[slot].used = 1;
      S.riders[slot].num = e->m_iRaceNum;
      copy(S.riders[slot].name, e->m_szName, sizeof S.riders[slot].name);
      copy(S.riders[slot].bike, e->m_szBikeName, sizeof S.riders[slot].bike);
      copy(S.riders[slot].category, e->m_szCategory, sizeof S.riders[slot].category);
    }
  }
  writeState();
  unlock();
}

EXPORT void RaceRemoveEntry(void *_pData, int _iDataSize) {
  const RaceRemove *e = (const RaceRemove *)_pData;
  int i;
  if (!e || _iDataSize < (int)sizeof(RaceRemove)) return;
  lock();
  for (i = 0; i < MAX_RIDERS; i++) if (S.riders[i].used && S.riders[i].num == e->m_iRaceNum) S.riders[i].used = 0;
  writeState();
  unlock();
}

EXPORT void RaceSession(void *_pData, int _iDataSize) {
  const RaceSessionData *e = (const RaceSessionData *)_pData;
  if (!e || _iDataSize < (int)sizeof(int)) return;
  lock(); S.session = e->m_iSession; writeState(); unlock();
}

/* ===================== Missing track detection =====================
 * When you pick a server whose track you don't have, MX Bikes opens its "Missing Track" window
 * (dialog idd_trackerror). It is registered twice with two near-identical handlers: 0xAB150 (the
 * World list; its text call returns to RVA 0xAB2AC) and 0xAFCD0 (returns to RVA 0xAFE1E). Each sets
 * the window's text with one call through the game's UI function pointer (stored at RVA 0x566C48):
 *     ui(0x112, control, "<track>" or "<track> - <layout>")
 * We swap that pointer for a tiny stub. The stub looks at every UI call, copies the text only for
 * those exact calls (code 0x112 returning to one of those two places), and always jumps on to the game's own function
 * with every register and stack argument untouched. No game code is patched.
 *
 * Safety:
 *  - Installed only if 43 bytes of the dialog handler match this game build exactly. Otherwise
 *    the state file says "paused" (game updated) and nothing is touched.
 *  - The original pointer is put back on Shutdown.
 *  - If the game ever crashes inside this DLL, the hook is switched off and stays off until
 *    MX Bikes Manager ships a new plugin (HOOK_BUILD changes); the app shows a pop-up for both.
 * Research notes: plugin/MISMATCH_NOTES.md. */
#define HOOK_BUILD 4
#define RVA_UI_SLOT  0x566C48u
#define RVA_SIG      0xAFDF3u
#define RVA_RETURN   0xAFE1Eu
#define RVA_SIG2     0xAB281u
#define RVA_RETURN2  0xAB2ACu

static const unsigned char SIG[43] = {
  0x4c, 0x8d, 0x05, 0xe6, 0xc0, 0x28, 0x00, 0x8b, 0xd3, 0xb9, 0x0a, 0x01, 0x00, 0x00, 0xff, 0x15,
  0x41, 0x6e, 0x4b, 0x00, 0x8b, 0x54, 0x24, 0x30, 0x4c, 0x8d, 0x84, 0x24, 0xa0, 0x02, 0x00, 0x00,
  0xb9, 0x12, 0x01, 0x00, 0x00, 0xff, 0x15, 0x2a, 0x6e, 0x4b, 0x00 };
static const unsigned char SIG2[43] = {
  0x4c, 0x8d, 0x05, 0x58, 0x0c, 0x29, 0x00, 0x8b, 0xd3, 0xb9, 0x0a, 0x01, 0x00, 0x00, 0xff, 0x15,
  0xb3, 0xb9, 0x4b, 0x00, 0x8b, 0x54, 0x24, 0x30, 0x4c, 0x8d, 0x84, 0x24, 0xa0, 0x02, 0x00, 0x00,
  0xb9, 0x12, 0x01, 0x00, 0x00, 0xff, 0x15, 0x9c, 0xb9, 0x4b, 0x00 };

/* Used by the assembly stub below, so not static. A return address left at 0 never matches. */
void *mxbm_orig_ui = 0;
void *mxbm_expect_ret = 0;
void *mxbm_expect_ret2 = 0;
void mxbm_capture(const char *text, const unsigned char *frame);
extern void mxbm_ui_stub(void);

/* Work queued for the game's own thread (see the livery test below). The game calls the UI
 * pointer from its main thread; the stub runs queued work there, before passing the call on. */
volatile LONG mxbm_pending = 0; /* bit 1: paint test, bit 2: live looks */
void mxbm_run_pending(void);

__asm__(
  ".intel_syntax noprefix\n"
  ".text\n"
  ".globl mxbm_ui_stub\n"
  "mxbm_ui_stub:\n"
  "  cmp dword ptr [rip + mxbm_pending], 0\n"
  "  je 3f\n"
  "  push rcx\n  push rdx\n  push r8\n  push r9\n"
  "  sub rsp, 0x28\n"
  "  call mxbm_run_pending\n"
  "  add rsp, 0x28\n"
  "  pop r9\n  pop r8\n  pop rdx\n  pop rcx\n"
  "3:\n"
  "  cmp ecx, 0x112\n"
  "  jne 1f\n"
  "  mov rax, [rsp]\n"
  "  cmp rax, [rip + mxbm_expect_ret]\n"
  "  je 2f\n"
  "  cmp rax, [rip + mxbm_expect_ret2]\n"
  "  jne 1f\n"
  "2:\n"
  "  push rcx\n  push rdx\n  push r8\n  push r9\n"
  "  sub rsp, 0x28\n"
  "  mov rcx, r8\n"
  "  lea rdx, [rsp + 0x50]\n"   /* the calling handler's stack frame (its rsp) */
  "  call mxbm_capture\n"
  "  add rsp, 0x28\n"
  "  pop r9\n  pop r8\n  pop rdx\n  pop rcx\n"
  "1:\n"
  "  jmp [rip + mxbm_orig_ui]\n"
  ".att_syntax prefix\n");

static char g_dir[MAX_PATH * 2];
static void **g_slot = 0;
static volatile LONG g_hookStop = 0;
static HANDLE g_hookThread = 0;
static PVOID g_veh = 0;
static unsigned char *g_selfBase = 0; static size_t g_selfSize = 0;

static void writeSmall(const char *name, const char *json) {
  char path[MAX_PATH * 2 + 40], tmp[MAX_PATH * 2 + 44]; FILE *f;
  sprintf(path, "%s%s", g_dir, name); sprintf(tmp, "%s.tmp", path);
  f = fopen(tmp, "wb"); if (!f) return;
  fwrite(json, 1, strlen(json), f); fclose(f);
  MoveFileExA(tmp, path, MOVEFILE_REPLACE_EXISTING);
}
static unsigned long long nowMs(void) { FILETIME ft; ULARGE_INTEGER u; GetSystemTimeAsFileTime(&ft); u.LowPart = ft.dwLowDateTime; u.HighPart = ft.dwHighDateTime; return (u.QuadPart - 116444736000000000ULL) / 10000ULL; }
static void hookState(const char *state, const char *detail) {
  char o[600]; size_t at = (size_t)sprintf(o, "{\"v\":1,\"build\":%d,\"state\":\"%s\",\"at\":%llu,\"detail\":", HOOK_BUILD, state, nowMs());
  at = jstr(o, at, detail ? detail : "", sizeof o - 4); o[at++] = '}'; o[at] = 0;
  writeSmall("mxbm_hook.json", o);
}

/* Runs on the game's UI thread, only for the Missing Track window. Keep it short. */
/* `frame` is the handler's own stack frame (0x390 bytes). It still holds the server-list row the
 * handler read (from +0x50) and the fields it split out of it, so the readable strings in it are
 * used for the server name and address below. */
void mxbm_capture(const char *text, const unsigned char *frame) {
  static char o[1024]; char name[128]; size_t at, i;
  if (!text) return;
  for (i = 0; i < sizeof name - 1 && text[i]; i++) name[i] = text[i];
  name[i] = 0;
  at = (size_t)sprintf(o, "{\"v\":2,\"at\":%llu,\"track\":", nowMs());
  at = jstr(o, at, name, sizeof o - 64);
  /* The row at frame+0x50 is a copy of the game's server record: an IPv4-mapped IPv6 address at
   * +0x0B (ff ff a b c d), the port big-endian at +0x11, the server name at +0x26. */
  if (frame && frame[0x5B] == 0xff && frame[0x5C] == 0xff && frame[0x5D]) {
    const unsigned char *a = frame + 0x5D; unsigned port = ((unsigned)frame[0x61] << 8) | frame[0x62];
    char server[64]; size_t k;
    for (k = 0; k < sizeof server - 1 && frame[0x76 + k] >= 0x20 && frame[0x76 + k] < 0x7f; k++) server[k] = (char)frame[0x76 + k];
    server[k] = 0;
    if (port) at += (size_t)sprintf(o + at, ",\"address\":\"%u.%u.%u.%u:%u\"", a[0], a[1], a[2], a[3], port);
    memcpy(o + at, ",\"server\":", 10); at += 10;
    at = jstr(o, at, server, sizeof o - 64);
  }
  o[at++] = '}'; o[at] = 0;
  writeSmall("mxbm_missing.json", o);
}

/* A crash with the instruction pointer inside this DLL: switch the hook off for good (until a new
 * plugin build), put the game's pointer back, then let the crash continue as it would have. */
/* Set while this plugin is running a game function itself (the livery test): a crash on that
 * thread then counts as ours even though it happens inside the game's code. */
static volatile DWORD g_gameCallThread = 0;
static LONG CALLBACK onCrash(EXCEPTION_POINTERS *e) {
  DWORD code = e->ExceptionRecord->ExceptionCode;
  unsigned char *ip = (unsigned char *)e->ExceptionRecord->ExceptionAddress;
  int inCall = g_gameCallThread && g_gameCallThread == GetCurrentThreadId();
  if (code != EXCEPTION_ACCESS_VIOLATION && code != EXCEPTION_ILLEGAL_INSTRUCTION && code != EXCEPTION_STACK_OVERFLOW && code != EXCEPTION_PRIV_INSTRUCTION) return EXCEPTION_CONTINUE_SEARCH;
  if (!inCall && (!g_selfBase || ip < g_selfBase || ip >= g_selfBase + g_selfSize)) return EXCEPTION_CONTINUE_SEARCH;
  if (g_slot && mxbm_orig_ui) InterlockedCompareExchangePointer((PVOID *)g_slot, mxbm_orig_ui, (PVOID)mxbm_ui_stub);
  stunUnhook();
  { char o[200]; sprintf(o, "{\"v\":1,\"build\":%d,\"at\":%llu}", HOOK_BUILD, nowMs()); writeSmall("mxbm_hook_disabled.json", o); }
  hookState("disabled", "MX Bikes crashed inside the MX Bikes Manager plugin");
  return EXCEPTION_CONTINUE_SEARCH;
}

/* Connected server, from the game (this build only): name at RVA 0x9CC334 (64 bytes, followed by
 * the MOTD) and the connection address at RVA 0xE53DE0. Browser joins use a server-list record
 * (01, IPv4-mapped IPv6 address from +0x0B, port big-endian at +0x11). Direct-connect joins use
 * (00, IPv4 at +0x01, port big-endian at +0x05). Online race events only. */
static int g_buildOk = 0;
static int connectedServer(char *name, size_t ncap, char *addr, size_t acap) {
  const unsigned char *base = (const unsigned char *)GetModuleHandleA(NULL), *nm, *cb;
  size_t i; unsigned port;
  if (!g_buildOk || !base || S.type != 2 || ncap < 2 || acap < 24) return 0;
  nm = base + 0x9CC334; cb = base + 0xE53DE0;
  for (i = 0; i < ncap - 1 && nm[i]; i++) { if (nm[i] < 0x20 || nm[i] == 0x7f) return 0; name[i] = (char)nm[i]; }
  name[i] = 0;
  if (!name[0]) return 0;
  if (cb[0] == 1 && cb[0x0B] == 0xff && cb[0x0C] == 0xff && cb[0x0D]) {
    port = ((unsigned)cb[0x11] << 8) | cb[0x12];
    if (!port) return 0;
    sprintf(addr, "%u.%u.%u.%u:%u", cb[0x0D], cb[0x0E], cb[0x0F], cb[0x10], port);
    return 1;
  }
  if (cb[0] != 0 || !cb[1]) return 0;
  port = ((unsigned)cb[5] << 8) | cb[6];
  if (!port) return 0;
  sprintf(addr, "%u.%u.%u.%u:%u", cb[1], cb[2], cb[3], cb[4], port);
  return 1;
}

/* Your own race number from your vehicle record (own index + 1 at RVA 0xE62710, number at +0x0C),
 * so other CoreMX users can find you in their game. This build only; 0 if not known. */
static int ownRaceNumber(void) {
  const unsigned char *base = (const unsigned char *)GetModuleHandleA(NULL);
  int own = 0, used = 0, num = 0; const unsigned char *rec;
  if (!g_buildOk || !base) return 0;
  if (!ReadProcessMemory(GetCurrentProcess(), base + 0xE62710, &own, 4, NULL) || own < 1 || own > 50) return 0;
  rec = base + 0xF4EE20 + (size_t)(own - 1) * 0x5B24;
  if (!ReadProcessMemory(GetCurrentProcess(), rec, &used, 4, NULL) || used != 1) return 0;
  if (!ReadProcessMemory(GetCurrentProcess(), rec + 0x0C, &num, 4, NULL)) return 0;
  return num > 0 && num < 100000 ? num : 0;
}

static int disabledForThisBuild(void) {
  char path[MAX_PATH * 2 + 40], buf[256] = {0}; FILE *f; int build = -1; char *p;
  sprintf(path, "%smxbm_hook_disabled.json", g_dir);
  f = fopen(path, "rb"); if (!f) return 0;
  fread(buf, 1, sizeof buf - 1, f); fclose(f);
  p = strstr(buf, "\"build\":"); if (p) build = atoi(p + 8);
  return build == HOOK_BUILD;
}

static DWORD WINAPI hookThread(LPVOID unused) {
  unsigned char *base = (unsigned char *)GetModuleHandleA(NULL);
  IMAGE_NT_HEADERS *nt; int waited;
  (void)unused;
  if (!base || ((IMAGE_DOS_HEADER *)base)->e_magic != IMAGE_DOS_SIGNATURE) { hookState("paused", "not running inside MX Bikes"); return 0; }
  nt = (IMAGE_NT_HEADERS *)(base + ((IMAGE_DOS_HEADER *)base)->e_lfanew);
  if (nt->OptionalHeader.SizeOfImage < RVA_UI_SLOT + 8) { hookState("paused", "not running inside MX Bikes"); return 0; }
  /* Each handler is watched only if its bytes match this game build exactly. */
  if (memcmp(base + RVA_SIG, SIG, sizeof SIG) == 0) mxbm_expect_ret = base + RVA_RETURN;
  if (memcmp(base + RVA_SIG2, SIG2, sizeof SIG2) == 0) mxbm_expect_ret2 = base + RVA_RETURN2;
  g_buildOk = mxbm_expect_ret || mxbm_expect_ret2;
  if (g_buildOk) stunStart(base);
  if (!mxbm_expect_ret && !mxbm_expect_ret2) {
    hookState("paused", "This MX Bikes version is newer than the plugin; missing-track detection waits for an MX Bikes Manager update");
    return 0;
  }
  g_slot = (void **)(base + RVA_UI_SLOT);
  /* The game fills the pointer while it starts up: wait for it (up to 2 minutes). */
  for (waited = 0; !g_hookStop && waited < 480; waited++) {
    void *cur = *(void *volatile *)g_slot;
    if (cur && cur != (void *)mxbm_ui_stub) {
      mxbm_orig_ui = cur;
      if (InterlockedCompareExchangePointer((PVOID *)g_slot, (PVOID)mxbm_ui_stub, cur) == cur) { hookState("active", ""); return 0; }
    }
    Sleep(250);
  }
  if (!g_hookStop) hookState("paused", "The game's UI did not start in time");
  return 0;
}

/* ===================== Public address for Host World (STUN) =====================
 * Someone hosting with Host World is reachable at their router's outside IP:port for the game's
 * UDP socket (local port 54210), which the router may map to a different outside port. The master
 * server sees that mapping; CoreMX can't ask it. Instead the plugin sends one STUN binding request
 * (stun.cloudflare.com:3478) from the game's own socket while in a session, every 2 minutes. The
 * reply carries the outside IP:port; the plugin takes it out of the game's receive call (the game
 * never sees it) and writes mxbm_public.json for CoreMX.
 * The game imports recvfrom by ordinal; its import slot (RVA 0x321988, this build) is wrapped only
 * after checking it points at ws2_32's recvfrom, and is restored on shutdown or a crash. */
#define RVA_IAT_RECVFROM 0x321988u
typedef int (WINAPI *recvfrom_t)(SOCKET, char *, int, int, struct sockaddr *, int *);
typedef int (WINAPI *sendto_t)(SOCKET, const char *, int, int, const struct sockaddr *, int);
typedef int (WINAPI *getsockname_t)(SOCKET, struct sockaddr *, int *);
typedef int (WINAPI *getaddrinfo_t)(const char *, const char *, const struct addrinfo *, struct addrinfo **);
typedef void (WINAPI *freeaddrinfo_t)(struct addrinfo *);
static recvfrom_t real_recvfrom; static sendto_t real_sendto; static getsockname_t real_getsockname;
static getaddrinfo_t real_getaddrinfo; static freeaddrinfo_t real_freeaddrinfo;
static void **g_iatRecv = 0;
static volatile SOCKET g_gameSock = 0;
static volatile int g_gameSockV6 = 0;
static unsigned char g_txid[12];
static volatile LONG g_stunPending = 0;
static HANDLE g_stunThread = 0;

/* A STUN binding success for our request: write the outside address. Returns 1 to drop the packet. */
static int stunReply(const unsigned char *b, int n) {
  int at, len;
  if (n < 20 || b[0] != 0x01 || b[1] != 0x01 || b[4] != 0x21 || b[5] != 0x12 || b[6] != 0xA4 || b[7] != 0x42) return 0;
  if (memcmp(b + 8, g_txid, 12) != 0) return 0;
  len = (b[2] << 8) | b[3];
  for (at = 20; at + 4 <= n && at + 4 <= 20 + len; ) {
    int type = (b[at] << 8) | b[at + 1], alen = (b[at + 2] << 8) | b[at + 3];
    const unsigned char *v = b + at + 4;
    if (at + 4 + alen > n) break;
    if ((type == 0x0020 || type == 0x8020 || type == 0x0001) && alen >= 8 && v[1] == 0x01) {
      int x = type != 0x0001;
      unsigned port = ((unsigned)v[2] << 8 | v[3]) ^ (x ? 0x2112 : 0);
      unsigned a0 = v[4] ^ (x ? 0x21 : 0), a1 = v[5] ^ (x ? 0x12 : 0), a2 = v[6] ^ (x ? 0xA4 : 0), a3 = v[7] ^ (x ? 0x42 : 0);
      char o[160];
      sprintf(o, "{\"v\":1,\"at\":%llu,\"address\":\"%u.%u.%u.%u:%u\"}", nowMs(), a0, a1, a2, a3, port);
      writeSmall("mxbm_public.json", o);
      InterlockedExchange(&g_stunPending, 0);
      return 1;
    }
    at += 4 + ((alen + 3) & ~3);
  }
  InterlockedExchange(&g_stunPending, 0);
  return 1;
}

static int WINAPI hk_recvfrom(SOCKET s, char *buf, int len, int flags, struct sockaddr *from, int *fromlen) {
  for (;;) {
    int r = real_recvfrom(s, buf, len, flags, from, fromlen);
    if (!g_gameSock && real_getsockname) {
      unsigned char a[64]; int al = sizeof a;
      /* port is at bytes 2..3 for both sockaddr_in and sockaddr_in6 */
      if (real_getsockname(s, (struct sockaddr *)a, &al) == 0 && ((a[2] << 8) | a[3]) == 54210) {
        g_gameSockV6 = ((struct sockaddr *)a)->sa_family == AF_INET6;
        g_gameSock = s;
      }
    }
    if (r >= 20 && g_stunPending && s == g_gameSock && stunReply((const unsigned char *)buf, r)) continue;
    return r;
  }
}

static DWORD WINAPI stunThread(LPVOID unused) {
  unsigned long long last = 0;
  (void)unused;
  while (!g_hookStop) {
    Sleep(1000);
    if (!g_gameSock || !S.inEvent || nowMs() - last < 120000) continue;
    last = nowMs();
    {
      struct addrinfo hints, *res = NULL; unsigned char req[20]; int i;
      memset(&hints, 0, sizeof hints); hints.ai_family = AF_INET; hints.ai_socktype = SOCK_DGRAM;
      if (!real_getaddrinfo || real_getaddrinfo("stun.cloudflare.com", "3478", &hints, &res) != 0 || !res) continue;
      req[0] = 0x00; req[1] = 0x01; req[2] = 0; req[3] = 0; req[4] = 0x21; req[5] = 0x12; req[6] = 0xA4; req[7] = 0x42;
      for (i = 0; i < 12; i++) g_txid[i] = (unsigned char)(rand() ^ (GetTickCount() >> (i % 8)));
      memcpy(req + 8, g_txid, 12);
      InterlockedExchange(&g_stunPending, 1);
      if (g_gameSockV6) {
        /* The game's socket is dual-stack IPv6: send to the IPv4-mapped address. */
        struct sockaddr_in6 to; const struct sockaddr_in *v4 = (const struct sockaddr_in *)res->ai_addr;
        memset(&to, 0, sizeof to); to.sin6_family = AF_INET6; to.sin6_port = v4->sin_port;
        to.sin6_addr.s6_addr[10] = 0xff; to.sin6_addr.s6_addr[11] = 0xff; memcpy(&to.sin6_addr.s6_addr[12], &v4->sin_addr, 4);
        real_sendto(g_gameSock, (const char *)req, 20, 0, (const struct sockaddr *)&to, sizeof to);
      } else {
        real_sendto(g_gameSock, (const char *)req, 20, 0, res->ai_addr, (int)res->ai_addrlen);
      }
      real_freeaddrinfo(res);
    }
  }
  return 0;
}

static void stunStart(unsigned char *base) {
  HMODULE ws = GetModuleHandleA("ws2_32.dll");
  DWORD old;
  if (!ws) return;
  real_recvfrom = (recvfrom_t)(void *)GetProcAddress(ws, "recvfrom");
  real_sendto = (sendto_t)(void *)GetProcAddress(ws, "sendto");
  real_getsockname = (getsockname_t)(void *)GetProcAddress(ws, "getsockname");
  real_getaddrinfo = (getaddrinfo_t)(void *)GetProcAddress(ws, "getaddrinfo");
  real_freeaddrinfo = (freeaddrinfo_t)(void *)GetProcAddress(ws, "freeaddrinfo");
  if (!real_recvfrom || !real_sendto || !real_getsockname || !real_getaddrinfo || !real_freeaddrinfo) return;
  g_iatRecv = (void **)(base + RVA_IAT_RECVFROM);
  if (*g_iatRecv != (void *)real_recvfrom) { g_iatRecv = 0; return; } /* not this build's import slot */
  if (!VirtualProtect(g_iatRecv, sizeof(void *), PAGE_READWRITE, &old)) { g_iatRecv = 0; return; }
  InterlockedExchangePointer(g_iatRecv, (void *)hk_recvfrom);
  VirtualProtect(g_iatRecv, sizeof(void *), old, &old);
  g_stunThread = CreateThread(NULL, 0, stunThread, NULL, 0, NULL);
}
static void stunUnhook(void) {
  DWORD old;
  if (g_iatRecv && VirtualProtect(g_iatRecv, sizeof(void *), PAGE_READWRITE, &old)) {
    InterlockedCompareExchangePointer(g_iatRecv, (void *)real_recvfrom, (void *)hk_recvfrom);
    VirtualProtect(g_iatRecv, sizeof(void *), old, &old);
  }
}
static void stunStop(void) {
  if (g_stunThread) { WaitForSingleObject(g_stunThread, 3000); CloseHandle(g_stunThread); g_stunThread = 0; }
  stunUnhook();
}

/* ===================== Server addresses from the game's server list =====================
 * When Multiplayer is open, the game keeps its server list as an array: pointer at RVA 0x5985D8,
 * int32 count at RVA 0x5985E0, records of 0x1D8 bytes (01, IPv4-mapped IPv6 address from +0x0B,
 * port big-endian at +0x11, name at +0x26). The list arrives from the master server in batches and
 * is rebuilt as you browse, so addresses are collected into an address book (each kept 6 hours
 * after it was last seen, at most 1000) and written to mxbm_servers.txt for CoreMX:
 *   coremx-serverlist 1 <unix ms>
 *   <ipv4>:<port>\t<name>
 * The array belongs to the game's UI thread and can be freed or moved at any moment, so it is
 * copied with ReadProcessMemory, which fails instead of faulting. Only on this game build (the
 * Missing Track signatures match). Reads only; nothing is written to the game. */
#define RVA_SRV_LIST  0x5985D8u
#define RVA_SRV_COUNT 0x5985E0u
#define SRV_STRIDE    0x1D8
#define SRV_MAX_ROWS  4096
#define BOOK_MAX      1000
#define BOOK_TTL_MS   (6ULL * 3600 * 1000)
typedef struct { char addr[24]; char name[64]; unsigned long long seen; } SrvEntry;
static SrvEntry g_book[BOOK_MAX];
static int g_bookN = 0;
static HANDLE g_srvThread = 0;
static volatile LONG g_srvStop = 0;

static int srvCopy(const void *from, void *to, size_t n) {
  SIZE_T got = 0;
  return ReadProcessMemory(GetCurrentProcess(), from, to, n, &got) && got == n;
}

/* Adds or refreshes one row. Returns 1 if the book changed in a way worth writing. */
static int bookPut(const char *addr, const char *name, unsigned long long now) {
  int i, oldest = 0;
  for (i = 0; i < g_bookN; i++) {
    if (strcmp(g_book[i].addr, addr) == 0) {
      int renamed = strcmp(g_book[i].name, name) != 0;
      if (renamed) copy(g_book[i].name, name, sizeof g_book[i].name);
      g_book[i].seen = now;
      return renamed;
    }
  }
  if (g_bookN < BOOK_MAX) i = g_bookN++;
  else { for (i = 1; i < g_bookN; i++) if (g_book[i].seen < g_book[oldest].seen) oldest = i; i = oldest; }
  copy(g_book[i].addr, addr, sizeof g_book[i].addr);
  copy(g_book[i].name, name, sizeof g_book[i].name);
  g_book[i].seen = now;
  return 1;
}

static void bookWrite(unsigned long long now) {
  static char o[BOOK_MAX * 96 + 64];
  size_t at = (size_t)sprintf(o, "coremx-serverlist 1 %llu\n", now);
  int i;
  for (i = 0; i < g_bookN; i++) at += (size_t)sprintf(o + at, "%s\t%s\n", g_book[i].addr, g_book[i].name);
  writeSmall("mxbm_servers.txt", o);
}

static void liveryTestPoll(void);
static void looksPoll(void);
static void ownRebuildPoll(void);
static DWORD WINAPI serverListThread(LPVOID unused) {
  const unsigned char *base = (const unsigned char *)GetModuleHandleA(NULL);
  unsigned char *rows = (unsigned char *)malloc((size_t)SRV_MAX_ROWS * SRV_STRIDE);
  unsigned long long lastWrite = 0;
  int dirty = 0;
  (void)unused;
  if (!rows) return 0;
  while (!g_srvStop) {
    unsigned long long now = nowMs();
    const unsigned char *list = 0; int count = 0, i;
    Sleep(500);
    liveryTestPoll();
    looksPoll();
    ownRebuildPoll();
    if (srvCopy(base + RVA_SRV_LIST, (void *)&list, sizeof list) && srvCopy(base + RVA_SRV_COUNT, &count, sizeof count) &&
        list && count > 0 && count <= SRV_MAX_ROWS && srvCopy(list, rows, (size_t)count * SRV_STRIDE)) {
      for (i = 0; i < count; i++) {
        const unsigned char *r = rows + (size_t)i * SRV_STRIDE;
        char addr[24], name[64]; size_t k; unsigned port;
        if (r[0] != 1 || r[0x0B] != 0xff || r[0x0C] != 0xff || !r[0x0D]) continue;
        port = ((unsigned)r[0x11] << 8) | r[0x12];
        if (!port) continue;
        /* Names are UTF-8; stop at the end or at a control character (no tabs or newlines in the file). */
        for (k = 0; k < sizeof name - 1 && r[0x26 + k] >= 0x20 && r[0x26 + k] != 0x7f; k++) name[k] = (char)r[0x26 + k];
        name[k] = 0;
        if (!name[0]) continue;
        sprintf(addr, "%u.%u.%u.%u:%u", r[0x0D], r[0x0E], r[0x0F], r[0x10], port);
        dirty |= bookPut(addr, name, now);
      }
    }
    for (i = 0; i < g_bookN; ) {
      if (now - g_book[i].seen > BOOK_TTL_MS) { g_book[i] = g_book[--g_bookN]; dirty = 1; } else i++;
    }
    /* Changes at most twice a second; an unchanged list renews its timestamp once a minute. */
    if (g_bookN && ((dirty && now - lastWrite >= 500) || now - lastWrite >= 60000)) { bookWrite(now); lastWrite = now; dirty = 0; }
  }
  free(rows);
  return 0;
}

/* ===================== Live paint test (your own rider and bike, on your screen only) =====================
 * Research step for live liveries and gear paints: repaint your own bike and rider with other
 * installed paints, without rebuilding, the way the game paints a freshly built vehicle (RVA
 * 0x4CE00, its "apply all paints" step). Started by a file mxbm_test_livery.txt with lines
 * key=value (bike, suit, gloves, boots, helmet, goggles; a line without '=' is a bike livery; an
 * empty file only lists what is installed). Result: mxbm_test_result.json.
 *
 * Engine command 0x9E paints a model from a .pnt path ("a.pnt|b.pnt" for two layers); it is sent
 * through the game's UI pointer. Model ids are in the vehicle record's block at +0x274:
 *   bike parts +0x00 +0x10 +0x14 +0x50 +0x60 +0x70   "<root>bikes\<bike>\paints\<name>.pnt"
 *   rider body +0x1D4   suit "<root>rider\riders\<rider>\paints\<name>.pnt" | gloves "...\gloves\<name>.pnt"
 *   boots      +0x1D8 +0x1DC                         "<root>rider\boots\<boots>\paints\<name>.pnt"
 *   helmet     +0x1E0   helmet "<root>rider\helmets\<helmet>\paints\<name>.pnt" | goggles "...\goggles\<name>.pnt"
 * Paint lists: entries of 0x18C bytes, +0x00 owner index (bike/rider/boots/helmet), +0x04 name,
 * +0x88 folder root. Record names: bike +0x30, bike paint +0x90, rider +0xD0, helmet +0xF0, helmet
 * paint +0x110, goggles +0x130, suit +0x170, boots +0x1B0, boots paint +0x1D0, gloves +0x1F0.
 * Vehicle records: RVA 0xF4EE20, stride 0x5B24, own index + 1 at RVA 0xE62710. (Record + 0x5B0C
 * is the pit stand.) The record is not changed: nothing is saved or sent, and the next rebuild
 * shows your own paints again. Checked against this game build by the bytes of RVA 0x4DC50. */
#define RVA_APPLY_LIVERY 0x4DC50u
static const unsigned char SIG_APPLY_LIVERY[14] = { 0x4c, 0x8b, 0xdc, 0x55, 0x56, 0x41, 0x54, 0x48, 0x81, 0xec, 0x60, 0x01, 0x00, 0x00 };
typedef void *(*dispatch_t)(int cmd, int id, const char *a, const char *b);
typedef struct { unsigned count, ptr, stride; } GameList;
static const GameList L_BIKES = { 0xF48218, 0xF4EDE8, 0x4334 }, L_RIDERS = { 0xF3DC60, 0xF3DC68, 0x1224 },
  L_BOOTS = { 0xF3DB58, 0xF4EDB0, 0x208 }, L_HELMETS = { 0xF3DC64, 0xF3DC70, 0x268 },
  L_PROT = { 0x106BB28, 0xF432A8, 0x1EC };
static const GameList P_BIKE = { 0x109DE88, 0xF4EDF8, 0x18C }, P_SUIT = { 0xF3DB50, 0xF3DC90, 0x18C },
  P_GLOVES = { 0xF3DC58, 0xF48208, 0x18C }, P_BOOTS = { 0xF48660, 0xF432A0, 0x18C },
  P_HELMET = { 0xF48620, 0x109E090, 0x18C }, P_GOGGLES = { 0x10A30F4, 0xF3DC28, 0x18C },
  P_PROT = { 0xF432C0, 0xF4EDD0, 0x18C };
static const int BIKE_PARTS[6] = { 0x00, 0x10, 0x14, 0x50, 0x60, 0x70 };
static const int BOOT_PARTS[2] = { 0x1D8, 0x1DC };
static const int BODY_PART[1] = { 0x1D4 }, HELMET_PART[1] = { 0x1E0 };

/* Paints the given parts in both model sets of a vehicle: the outside one (block at record +0x274)
 * and, for your own vehicle, the first-person one the game builds with the prefix "cockpit/"
 * (block 0x3C4 further on; empty for other riders). */
static void paintParts(dispatch_t dispatch, const unsigned char *rec, const int *parts, int n, const char *path) {
  int set, i;
  for (set = 0; set < 2; set++)
    for (i = 0; i < n; i++) {
      int id = *(const int *)(rec + 0x274 + set * 0x3C4 + parts[i]);
      if (id > 0) dispatch(0x9E, id, path, path);
    }
}
static char g_testRequest[1024];

/* Index of a model by folder name in one of the game's lists, or -1. */
static int modelIndex(const unsigned char *base, GameList l, const char *name) {
  int n = 0, i; const unsigned char *p = 0; char id[65];
  if (!name[0] || !srvCopy(base + l.count, &n, 4) || !srvCopy(base + l.ptr, (void *)&p, sizeof p) || n <= 0 || n > 20000 || !p) return -1;
  for (i = 0; i < n; i++) {
    if (!srvCopy(p + (size_t)i * l.stride, id, 64)) return -1;
    id[64] = 0;
    if (_stricmp(id, name) == 0) return i;
  }
  return -1;
}

/* Finds paint `name` of model `owner` and formats its .pnt path into out (empty if not found).
 * Adds every paint of that model to the JSON list `opts`. Returns 1 if found. */
static int paintPath(const unsigned char *base, GameList l, int owner, const char *ownerName, const char *name,
                     const char *fmt, char *out, size_t cap, char *opts, size_t *oat, size_t ocap) {
  static unsigned char e[0x18C];
  int n = 0, i, found = 0, listed = 0; const unsigned char *p = 0;
  out[0] = 0;
  if (owner < 0 || !srvCopy(base + l.count, &n, 4) || !srvCopy(base + l.ptr, (void *)&p, sizeof p) || n <= 0 || n > 100000 || !p) return 0;
  for (i = 0; i < n; i++) {
    char nm[0x85], root[0x105];
    if (!srvCopy(p + (size_t)i * l.stride, e, sizeof e)) break;
    if (*(int *)e != owner) continue;
    memcpy(nm, e + 4, 0x84); nm[0x84] = 0;
    if (listed++ < 60 && *oat + 140 < ocap) { if (opts[*oat - 1] != '[') opts[(*oat)++] = ','; *oat = jstr(opts, *oat, nm, ocap - 4); opts[*oat] = 0; }
    if (!found && name[0] && _stricmp(nm, name) == 0) {
      memcpy(root, e + 0x88, 0x104); root[0x104] = 0;
      if (strlen(root) + strlen(ownerName) + strlen(nm) + strlen(fmt) < cap) { sprintf(out, fmt, root, ownerName, nm); found = 1; }
    }
  }
  return found;
}

static void testValue(const char *req, const char *key, char *out, size_t cap) {
  size_t kl = strlen(key); const char *p = req;
  out[0] = 0;
  while (*p) {
    const char *eol = strchr(p, '\n'); size_t len = eol ? (size_t)(eol - p) : strlen(p);
    if (len > kl && strncmp(p, key, kl) == 0 && p[kl] == '=') {
      size_t vl = len - kl - 1; if (vl >= cap) vl = cap - 1;
      memcpy(out, p + kl + 1, vl); out[vl] = 0;
      while (vl && (out[vl - 1] == '\r' || out[vl - 1] == ' ')) out[--vl] = 0;
      return;
    }
    p += len; if (*p) p++;
  }
}

/* Gear model rebuild test (other riders, your screen only). Vehicle build state at record +0x4EE8:
 * 0 = built, 2 = remove and rebuild. The game's own loop (RVA 0x6E22F, which tests the state at
 * RVA 0x6EC21) removes the old look with RVA 0x4E0D0 and builds again from the names in the record,
 * swapping in defaults for anything not installed. Request keys: riders=1 (list), rebuild=<race
 * number>, helmet=, helmet_paint=, boots=, boots_paint=. Never your own vehicle. */
static const unsigned char SIG_REMOVE_LOOK[16] = { 0x40, 0x56, 0x48, 0x83, 0xec, 0x20, 0x8b, 0x91, 0x54, 0x4c, 0x00, 0x00, 0x48, 0x8b, 0xf1, 0xb9 };
static const unsigned char SIG_STATE_TEST[9] = { 0x41, 0x83, 0xbc, 0x24, 0x18, 0xb1, 0xff, 0xff, 0x00 };
static void setName(unsigned char *field, const char *value) { size_t n = strlen(value); if (n > 31) n = 31; memset(field, 0, 32); memcpy(field, value, n); }
static size_t rebuildTest(unsigned char *base, const char *req, int own, char *o, size_t at, size_t cap) {
  char num[16], helmet[64], hpaint[132], boots[64], bpaint[132]; int target = -1, want, i, first = 1;
  testValue(req, "rebuild", num, sizeof num); want = num[0] ? atoi(num) : -1;
  memcpy(o + at, ",\"riders\":[", 11); at += 11;
  for (i = 0; i < 50; i++) {
    unsigned char *r = base + 0xF4EE20 + (size_t)i * 0x5B24; char nm[33];
    if (*(const int *)r != 1) continue;
    if (want >= 0 && *(const int *)(r + 0x0C) == want && i != own - 1 && target < 0) target = i;
    if (at + 400 >= cap) continue;
    at += (size_t)sprintf(o + at, "%s{\"slot\":%d,\"num\":%d,\"own\":%s,\"state\":%d", first ? "" : ",", i, *(const int *)(r + 0x0C), i == own - 1 ? "true" : "false", *(const int *)(r + 0x4EE8));
    first = 0;
#define FIELD(key, off) do { memcpy(nm, r + (off), 32); nm[32] = 0; memcpy(o + at, ",\"" key "\":", sizeof(key) + 3); at += sizeof(key) + 3; at = jstr(o, at, nm, cap - 64); } while (0)
    FIELD("name", 0x10); FIELD("bike", 0x30); FIELD("rider", 0xD0); FIELD("helmet", 0xF0); FIELD("helmet_paint", 0x110); FIELD("boots", 0x1B0); FIELD("boots_paint", 0x1D0);
#undef FIELD
    o[at++] = '}';
  }
  o[at++] = ']';
  if (want < 0) return at + (size_t)sprintf(o + at, ",\"reason\":\"listed riders\"}");
  if (target < 0) return at + (size_t)sprintf(o + at, ",\"reason\":\"no other rider with that number\"}");
  if (memcmp(base + 0x4E0D0, SIG_REMOVE_LOOK, sizeof SIG_REMOVE_LOOK) != 0 || memcmp(base + 0x6EC21, SIG_STATE_TEST, sizeof SIG_STATE_TEST) != 0)
    return at + (size_t)sprintf(o + at, ",\"reason\":\"game build differs\"}");
  testValue(req, "helmet", helmet, sizeof helmet); testValue(req, "helmet_paint", hpaint, sizeof hpaint);
  testValue(req, "boots", boots, sizeof boots); testValue(req, "boots_paint", bpaint, sizeof bpaint);
  if (helmet[0] && modelIndex(base, L_HELMETS, helmet) < 0) return at + (size_t)sprintf(o + at, ",\"reason\":\"that helmet is not installed\"}");
  if (boots[0] && modelIndex(base, L_BOOTS, boots) < 0) return at + (size_t)sprintf(o + at, ",\"reason\":\"those boots are not installed\"}");
  {
    unsigned char *r = base + 0xF4EE20 + (size_t)target * 0x5B24;
    int before = *(const int *)(r + 0x4EE8);
    if (helmet[0]) { setName(r + 0xF0, helmet); setName(r + 0x110, hpaint); }
    if (boots[0]) { setName(r + 0x1B0, boots); setName(r + 0x1D0, bpaint); }
    *(volatile int *)(r + 0x4EE8) = 2;
    return at + (size_t)sprintf(o + at, ",\"slot\":%d,\"stateBefore\":%d,\"reason\":\"rebuild requested\"}", target, before);
  }
}

/* Runs on the game's main thread, from the UI stub. */
static void runPaintTest(void) {
  unsigned char *base = (unsigned char *)GetModuleHandleA(NULL);
  static char o[32768], a[MAX_PATH * 2], b[MAX_PATH * 2], two[MAX_PATH * 4 + 2];
  char req[1024], want[132], name[33], owner[33];
  const unsigned char *rec; int own = 0, idx, i, found, applied = 0;
  size_t at;
  dispatch_t dispatch = (dispatch_t)mxbm_orig_ui;
  copy(req, g_testRequest, sizeof req);
  if (req[0] && !strchr(req, '=')) { char tmp[1024]; sprintf(tmp, "bike=%.1000s", req); copy(req, tmp, sizeof req); }
  at = (size_t)sprintf(o, "{\"v\":2,\"at\":%llu,\"request\":", nowMs());
  at = jstr(o, at, req, sizeof o - 64);
#define FAIL(msg) do { at += (size_t)sprintf(o + at, ",\"reason\":\"%s\"}", msg); writeSmall("mxbm_test_result.json", o); return; } while (0)
  if (!S.inEvent) FAIL("not in a session");
  if (memcmp(base + RVA_APPLY_LIVERY, SIG_APPLY_LIVERY, sizeof SIG_APPLY_LIVERY) != 0) FAIL("game build differs");
  if (!srvCopy(base + 0xE62710, &own, 4) || own < 1 || own > 64) FAIL("own vehicle not found");
  rec = base + 0xF4EE20 + (size_t)(own - 1) * 0x5B24;
  testValue(req, "riders", want, sizeof want);
  if (want[0] || strstr(req, "rebuild=")) { at = rebuildTest(base, req, own, o, at, sizeof o); writeSmall("mxbm_test_result.json", o); return; }
  if (!*(const int *)(rec + 0x274)) FAIL("no model right now");
#define REC(off) (memcpy(name, rec + (off), 32), name[32] = 0, name)
#define WANT(key, off) (testValue(req, key, want, sizeof want), want[0] ? want : REC(off))
#define PART(label) do { memcpy(o + at, ",\"" label "\":[", sizeof(label) + 4); at += sizeof(label) + 4; } while (0)
  g_gameCallThread = GetCurrentThreadId();

  /* Bike livery. */
  copy(owner, REC(0x30), sizeof owner); idx = modelIndex(base, L_BIKES, owner);
  PART("bike"); found = paintPath(base, P_BIKE, idx, owner, WANT("bike", 0x90), "%sbikes\\%s\\paints\\%s.pnt", a, sizeof a, o, &at, sizeof o - 2000); o[at++] = ']';
  testValue(req, "bike", want, sizeof want);
  if (want[0] && found) { paintParts(dispatch, rec, BIKE_PARTS, 6, a); applied |= 1; }

  /* Rider body: suit | gloves. */
  copy(owner, REC(0xD0), sizeof owner); idx = modelIndex(base, L_RIDERS, owner);
  PART("suit"); found = paintPath(base, P_SUIT, idx, owner, WANT("suit", 0x170), "%srider\\riders\\%s\\paints\\%s.pnt", a, sizeof a, o, &at, sizeof o - 2000); o[at++] = ']';
  PART("gloves"); found |= paintPath(base, P_GLOVES, idx, owner, WANT("gloves", 0x1F0), "%srider\\riders\\%s\\gloves\\%s.pnt", b, sizeof b, o, &at, sizeof o - 2000) << 1; o[at++] = ']';
  testValue(req, "suit", want, sizeof want); i = want[0] != 0; testValue(req, "gloves", want, sizeof want); i |= want[0] != 0;
  if (i && found) { sprintf(two, "%s%s%s", a, b[0] ? "|" : "", b); paintParts(dispatch, rec, BODY_PART, 1, two); applied |= 2; }

  /* Boots (two models). */
  copy(owner, REC(0x1B0), sizeof owner); idx = modelIndex(base, L_BOOTS, owner);
  PART("boots"); found = paintPath(base, P_BOOTS, idx, owner, WANT("boots", 0x1D0), "%srider\\boots\\%s\\paints\\%s.pnt", a, sizeof a, o, &at, sizeof o - 2000); o[at++] = ']';
  testValue(req, "boots", want, sizeof want);
  if (want[0] && found) { paintParts(dispatch, rec, BOOT_PARTS, 2, a); applied |= 4; }

  /* Helmet: helmet paint | goggles. */
  copy(owner, REC(0xF0), sizeof owner); idx = modelIndex(base, L_HELMETS, owner);
  PART("helmet"); found = paintPath(base, P_HELMET, idx, owner, WANT("helmet", 0x110), "%srider\\helmets\\%s\\paints\\%s.pnt", a, sizeof a, o, &at, sizeof o - 2000); o[at++] = ']';
  PART("goggles"); found |= paintPath(base, P_GOGGLES, idx, owner, WANT("goggles", 0x130), "%srider\\helmets\\%s\\goggles\\%s.pnt", b, sizeof b, o, &at, sizeof o - 2000) << 1; o[at++] = ']';
  testValue(req, "helmet", want, sizeof want); i = want[0] != 0; testValue(req, "goggles", want, sizeof want); i |= want[0] != 0;
  if (i && found) { sprintf(two, "%s%s%s", a, b[0] ? "|" : "", b); paintParts(dispatch, rec, HELMET_PART, 1, two); applied |= 8; }

  g_gameCallThread = 0;
  at += (size_t)sprintf(o + at, ",\"applied\":%d,\"reason\":\"%s\"}", applied, req[0] ? "done" : "listed only");
  writeSmall("mxbm_test_result.json", o);
#undef FAIL
#undef REC
#undef WANT
#undef PART
}

/* Polled from the server-list thread: a request file queues the test for the game's thread. */
static void liveryTestPoll(void) {
  char path[MAX_PATH * 2 + 40], buf[1024] = {0}; FILE *f; size_t n;
  if (!mxbm_orig_ui || (mxbm_pending & 1)) return; /* needs the UI hook to reach the game's thread */
  sprintf(path, "%smxbm_test_livery.txt", g_dir);
  f = fopen(path, "rb"); if (!f) return;
  n = fread(buf, 1, sizeof buf - 1, f); fclose(f);
  DeleteFileA(path);
  while (n && (buf[n - 1] == '\r' || buf[n - 1] == '\n' || buf[n - 1] == ' ')) buf[--n] = 0;
  buf[n] = 0;
  copy(g_testRequest, buf, sizeof g_testRequest);
  InterlockedOr(&mxbm_pending, 1);
}

/* ===================== Live looks: other CoreMX riders on your screen =====================
 * CoreMX writes mxbm_looks.txt (tab-separated) after downloading the free gear of other CoreMX
 * users on your server:
 *   coremx-looks 1 <stamp>
 *   reload <TAB> bikepaints,helmets,helmetpaints,boots,bootpaints,riderpaints
 *   look <TAB> race number <TAB> bike id <TAB> bike paint <TAB> rider <TAB> helmet <TAB> helmet paint
 *        <TAB> goggles <TAB> suit <TAB> gloves <TAB> boots <TAB> boots paint      (empty = keep)
 * On the game's thread, the plugin re-runs the game's own content loaders for the listed kinds (as
 * MX Bikes does at start-up, only while in a session), then finds each rider by race number and
 * bike in the vehicle records. Paint changes are painted straight away (engine command 0x9E, as the
 * game's paint step does); a different helmet, boots or rider model is written into the record and
 * the record's build state set to 2, so the game removes and rebuilds that rider itself. Names that
 * are not installed are skipped. Only what your game draws changes; nothing is sent. Every game
 * address used is checked first against fingerprints of this build. Result: mxbm_looks_result.json.
 * Research notes: plugin/LIVE_GEAR_NOTES.md. */
#define LOOK_MAX 50
typedef struct { int num; char bike[64]; char f[11][64]; } Look; /* f: bikePaint rider helmet helmetPaint goggles suit gloves boots bootsPaint protection protectionPaint */
static Look g_looks[LOOK_MAX], g_looksWork[LOOK_MAX];
static int g_lookCount = 0;
static unsigned long long g_looksStamp = 0, g_looksDone = 0;
static char g_reload[160];
static FILETIME g_looksMtime;
static int g_looksOk = -1; /* fingerprint check: -1 not yet, 0 failed, 1 ok */

static unsigned fnv(const unsigned char *p, size_t n) { unsigned h = 0x811c9dc5u; while (n--) { h ^= *p++; h *= 0x01000193u; } return h; }
static int looksBuildOk(const unsigned char *base) {
  if (g_looksOk < 0)
    g_looksOk = memcmp(base + RVA_APPLY_LIVERY, SIG_APPLY_LIVERY, sizeof SIG_APPLY_LIVERY) == 0 &&
                memcmp(base + 0x4E0D0, SIG_REMOVE_LOOK, sizeof SIG_REMOVE_LOOK) == 0 &&
                memcmp(base + 0x6EC21, SIG_STATE_TEST, sizeof SIG_STATE_TEST) == 0 &&
                fnv(base + 0xEF6EF, 0xEF913 - 0xEF6EF) == 0xde7530d6u &&   /* start-up loader blocks */
                fnv(base + 0x17F80, 0x58) == 0xb4b4d3f3u &&                 /* helmets loader */
                fnv(base + 0x19DA0, 0x58) == 0x8f351eceu;                   /* boots loader */
  return g_looksOk;
}

/* One start-up block: the caller zeroes two counts and the list pointer, then runs the loader
 * for the game folder ("" at RVA 0x3333EB) and, if set, the mods folder (string at RVA 0xE54B44). */
typedef void (*loader_t)(const char *root);
static void reloadList(unsigned char *base, unsigned loader, unsigned c1, unsigned c2, unsigned ptr) {
  *(int *)(base + c1) = 0; *(int *)(base + c2) = 0; *(void **)(base + ptr) = 0;
  ((loader_t)(void *)(base + loader))((const char *)(base + 0x3333EB));
  if (base[0xE54B44]) ((loader_t)(void *)(base + loader))((const char *)(base + 0xE54B44));
}
static void reloadLists(unsigned char *base, const char *kinds) {
  if (strstr(kinds, "bikepaints")) reloadList(base, 0x17320, 0x109DE88, 0xF3DC40, 0xF4EDF8);
  if (strstr(kinds, "helmets")) ((void (*)(void))(void *)(base + 0x17F80))();       /* resets its own list */
  if (strstr(kinds, "helmets") || strstr(kinds, "helmetpaints")) {
    reloadList(base, 0x18360, 0xF48620, 0xF3DB64, 0x109E090);                        /* helmet paints */
    reloadList(base, 0x189C0, 0x10A30F4, 0xF4EDDC, 0xF3DC28);                        /* goggles */
  }
  if (strstr(kinds, "riderpaints")) {
    reloadList(base, 0x19330, 0xF3DB50, 0x109DEA8, 0xF3DC90);                        /* suits */
    reloadList(base, 0x1A770, 0xF3DC58, 0xF432B4, 0xF48208);                         /* gloves */
  }
  /* ("boots" does not occur inside "bootpaints", "helmets" inside "helmetpaints", nor "protections"
   * inside "protectionpaints".) */
  if (strstr(kinds, "protections")) reloadList(base, 0x1C140, 0x106BB28, 0x109DEB0, 0xF432A8);
  if (strstr(kinds, "protections") || strstr(kinds, "protectionpaints")) reloadList(base, 0x1C450, 0xF432C0, 0xF48608, 0xF4EDD0);
  if (strstr(kinds, "boots")) ((void (*)(void))(void *)(base + 0x19DA0))();         /* resets its own list */
  if (strstr(kinds, "boots") || strstr(kinds, "bootpaints"))
    reloadList(base, 0x1A110, 0xF48660, 0xF4EDE0, 0xF432A0);                         /* boots paints */
}

/* Paint path for `name` of model `owner` (or 0). */
static int findPaint(const unsigned char *base, GameList l, GameList models, const char *model, const char *name, const char *fmt, char *out, size_t cap) {
  char opts[8] = "["; size_t oat = 1;
  if (!name[0]) { out[0] = 0; return 0; }
  return paintPath(base, l, modelIndex(base, models, model), model, name, fmt, out, cap, opts, &oat, 2);
}

/* Repaints groups of a built vehicle from the names in its record (1 bike, 2 body: suit|gloves,
 * 4 boots, 8 helmet: helmet paint|goggles), the way the game's paint step does, in both model
 * sets (outside and, for your own vehicle, first person). Returns how many groups were painted. */
static int repaintGroups(const unsigned char *base, dispatch_t dispatch, const unsigned char *r, int groups) {
  static char a[MAX_PATH * 2], b[MAX_PATH * 2], two[MAX_PATH * 4 + 2];
  char bike[33], rider[33], helmet[33], boots[33], n1[33], n2[33]; int painted = 0;
#define RN(dst, off) (memcpy(dst, r + (off), 32), dst[32] = 0, dst)
  RN(bike, 0x30); RN(rider, 0xD0); RN(helmet, 0xF0); RN(boots, 0x1B0);
  if (groups & 1 && findPaint(base, P_BIKE, L_BIKES, bike, RN(n1, 0x90), "%sbikes\\%s\\paints\\%s.pnt", a, sizeof a)) { paintParts(dispatch, r, BIKE_PARTS, 6, a); painted++; }
  if (groups & 2) {
    findPaint(base, P_SUIT, L_RIDERS, rider, RN(n1, 0x170), "%srider\\riders\\%s\\paints\\%s.pnt", a, sizeof a);
    findPaint(base, P_GLOVES, L_RIDERS, rider, RN(n2, 0x1F0), "%srider\\riders\\%s\\gloves\\%s.pnt", b, sizeof b);
    sprintf(two, "%s%s%s", a, b[0] ? "|" : "", b); paintParts(dispatch, r, BODY_PART, 1, two); painted++;
  }
  if (groups & 4 && findPaint(base, P_BOOTS, L_BOOTS, boots, RN(n1, 0x1D0), "%srider\\boots\\%s\\paints\\%s.pnt", a, sizeof a)) { paintParts(dispatch, r, BOOT_PARTS, 2, a); painted++; }
  if (groups & 8) {
    findPaint(base, P_HELMET, L_HELMETS, helmet, RN(n1, 0x110), "%srider\\helmets\\%s\\paints\\%s.pnt", a, sizeof a);
    findPaint(base, P_GOGGLES, L_HELMETS, helmet, RN(n2, 0x130), "%srider\\helmets\\%s\\goggles\\%s.pnt", b, sizeof b);
    sprintf(two, "%s%s%s", a, b[0] ? "|" : "", b); paintParts(dispatch, r, HELMET_PART, 1, two); painted++;
  }
#undef RN
  return painted;
}

static void applyLooks(void) {
  unsigned char *base = (unsigned char *)GetModuleHandleA(NULL);
  static char o[16384], a[MAX_PATH * 2];
  dispatch_t dispatch = (dispatch_t)mxbm_orig_ui;
  char reload[160]; unsigned long long stamp; int n, i, own = 0, first = 1;
  size_t at;
  if (!S.inEvent || !dispatch || !looksBuildOk(base)) return;
  lock(); n = g_lookCount; memcpy(g_looksWork, g_looks, sizeof(Look) * (size_t)n); stamp = g_looksStamp; copy(reload, g_reload, sizeof reload); unlock();
  srvCopy(base + 0xE62710, &own, 4);
  g_gameCallThread = GetCurrentThreadId();
  if (stamp != g_looksDone && reload[0]) reloadLists(base, reload);
  at = (size_t)sprintf(o, "{\"v\":1,\"at\":%llu,\"stamp\":%llu,\"reloaded\":", nowMs(), stamp);
  at = jstr(o, at, stamp != g_looksDone ? reload : "", sizeof o - 64);
  g_looksDone = stamp;
  memcpy(o + at, ",\"riders\":[", 11); at += 11;
  for (i = 0; i < n; i++) {
    const Look *L = &g_looksWork[i];
    unsigned char *r = 0; int s, rebuild = 0, painted = 0, skipped = 0;
    char nm[33];
    for (s = 0; s < 50; s++) {
      unsigned char *c = base + 0xF4EE20 + (size_t)s * 0x5B24;
      if (*(const int *)c != 1 || s == own - 1 || *(const int *)(c + 0x0C) != L->num) continue;
      memcpy(nm, c + 0x30, 32); nm[32] = 0;
      if (_stricmp(nm, L->bike) == 0) { r = c; break; }
    }
    if (r) {
      /* Models: helmet, boots, rider, protection ("None" = no protection). Written only if
       * installed; a change means a rebuild. */
      static const int MODEL_OFF[4] = { 0xF0, 0x1B0, 0xD0, 0x210 }, MODEL_F[4] = { 2, 7, 1, 9 };
      const GameList *MODEL_L[4] = { &L_HELMETS, &L_BOOTS, &L_RIDERS, &L_PROT };
      int m, groups = 0;
      for (m = 0; m < 4; m++) {
        const char *want = L->f[MODEL_F[m]];
        int none = m == 3 && _stricmp(want, "None") == 0;
        memcpy(nm, r + MODEL_OFF[m], 32); nm[32] = 0;
        if (!want[0] || _stricmp(nm, none ? "" : want) == 0) continue;
        if (!none && modelIndex(base, *MODEL_L[m], want) < 0) { skipped++; continue; }
        setName(r + MODEL_OFF[m], none ? "" : want); rebuild = 1;
      }
      /* Protection paint: drawn when the protection is built, so a change also rebuilds. */
      {
        const char *want = L->f[10]; char prot[33];
        memcpy(prot, r + 0x210, 32); prot[32] = 0; memcpy(nm, r + 0x230, 32); nm[32] = 0;
        if (want[0] && prot[0] && _stricmp(nm, want) != 0) {
          if (findPaint(base, P_PROT, L_PROT, prot, want, "%srider\\protections\\%s\\paints\\%s.pnt", a, sizeof a)) { setName(r + 0x230, want); rebuild = 1; }
          else skipped++;
        }
      }
      /* Paints: written only if installed for the (new) model; groups to repaint. */
      {
        char bike[33], rider[33], helmet[33], boots[33];
        static const int P_OFF[6] = { 0x90, 0x110, 0x130, 0x170, 0x1F0, 0x1D0 }, P_F[6] = { 0, 3, 4, 5, 6, 8 }, P_GROUP[6] = { 1, 8, 8, 2, 2, 4 };
        memcpy(bike, r + 0x30, 32); bike[32] = 0; memcpy(rider, r + 0xD0, 32); rider[32] = 0;
        memcpy(helmet, r + 0xF0, 32); helmet[32] = 0; memcpy(boots, r + 0x1B0, 32); boots[32] = 0;
        for (m = 0; m < 6; m++) {
          const char *want = L->f[P_F[m]]; int ok;
          memcpy(nm, r + P_OFF[m], 32); nm[32] = 0;
          if (!want[0] || _stricmp(nm, want) == 0) continue;
          switch (m) {
            case 0: ok = findPaint(base, P_BIKE, L_BIKES, bike, want, "%sbikes\\%s\\paints\\%s.pnt", a, sizeof a); break;
            case 1: ok = findPaint(base, P_HELMET, L_HELMETS, helmet, want, "%srider\\helmets\\%s\\paints\\%s.pnt", a, sizeof a); break;
            case 2: ok = findPaint(base, P_GOGGLES, L_HELMETS, helmet, want, "%srider\\helmets\\%s\\goggles\\%s.pnt", a, sizeof a); break;
            case 3: ok = findPaint(base, P_SUIT, L_RIDERS, rider, want, "%srider\\riders\\%s\\paints\\%s.pnt", a, sizeof a); break;
            case 4: ok = findPaint(base, P_GLOVES, L_RIDERS, rider, want, "%srider\\riders\\%s\\gloves\\%s.pnt", a, sizeof a); break;
            default: ok = findPaint(base, P_BOOTS, L_BOOTS, boots, want, "%srider\\boots\\%s\\paints\\%s.pnt", a, sizeof a); break;
          }
          if (!ok) { skipped++; continue; }
          setName(r + P_OFF[m], want); groups |= P_GROUP[m];
        }
        if (rebuild) {
          if (*(const int *)(r + 0x4EE8) == 0) *(volatile int *)(r + 0x4EE8) = 2;
        } else if (groups && *(const int *)(r + 0x4EE8) == 0 && *(const int *)(r + 0x274) > 0) {
          painted += repaintGroups(base, dispatch, r, groups);
        }
      }
    }
    if (at + 160 < sizeof o)
      at += (size_t)sprintf(o + at, "%s{\"num\":%d,\"found\":%s,\"rebuild\":%s,\"repainted\":%d,\"notInstalled\":%d}", first ? "" : ",", L->num, r ? "true" : "false", rebuild ? "true" : "false", painted, skipped);
    first = 0;
  }
  g_gameCallThread = 0;
  o[at++] = ']'; o[at++] = '}'; o[at] = 0;
  writeSmall("mxbm_looks_result.json", o);
}

/* Polled from the server-list thread: reads mxbm_looks.txt when it changes, and asks for a pass on
 * the game's thread every 5 seconds while there are looks (riders join, builds finish). */
static void looksPoll(void) {
  static unsigned long long lastPass = 0;
  char path[MAX_PATH * 2 + 40]; WIN32_FILE_ATTRIBUTE_DATA fa;
  unsigned long long now = nowMs();
  if (!mxbm_orig_ui) return;
  sprintf(path, "%smxbm_looks.txt", g_dir);
  if (!GetFileAttributesExA(path, GetFileExInfoStandard, &fa)) {
    if (g_lookCount) { lock(); g_lookCount = 0; unlock(); }
    return;
  }
  if (CompareFileTime(&fa.ftLastWriteTime, &g_looksMtime) != 0 && fa.nFileSizeLow < 64 * 1024) {
    static char buf[64 * 1024]; FILE *f = fopen(path, "rb"); size_t len; char *line, *next;
    Look tmp[LOOK_MAX]; int count = 0; char reload[160] = ""; unsigned long long stamp = 0;
    if (!f) return;
    len = fread(buf, 1, sizeof buf - 1, f); fclose(f); buf[len] = 0;
    if (strncmp(buf, "coremx-looks 1 ", 15) != 0) return;
    g_looksMtime = fa.ftLastWriteTime;
    stamp = _strtoui64(buf + 15, NULL, 10);
    for (line = buf; line && *line; line = next) {
      char *cols[16]; int c = 0;
      next = strchr(line, '\n'); if (next) *next++ = 0;
      { size_t ll = strlen(line); if (ll && line[ll - 1] == '\r') line[ll - 1] = 0; }
      cols[c++] = line;
      while (c < 16) { char *t = strchr(cols[c - 1], '\t'); if (!t) break; *t = 0; cols[c++] = t + 1; }
      if (strcmp(cols[0], "reload") == 0 && c > 1) copy(reload, cols[1], sizeof reload);
      else if (strcmp(cols[0], "look") == 0 && c >= 12 && count < LOOK_MAX) {
        int k; Look *L = &tmp[count]; memset(L, 0, sizeof *L);
        L->num = atoi(cols[1]); copy(L->bike, cols[2], sizeof L->bike);
        for (k = 0; k < 11 && 3 + k < c; k++) copy(L->f[k], cols[3 + k], sizeof L->f[k]);
        if (L->num > 0 && L->bike[0]) count++;
      }
    }
    lock(); memcpy(g_looks, tmp, sizeof(Look) * (size_t)count); g_lookCount = count; g_looksStamp = stamp; copy(g_reload, reload, sizeof g_reload); unlock();
    lastPass = 0;
  }
  if (g_lookCount && S.inEvent && now - lastPass >= 5000) { lastPass = now; InterlockedOr(&mxbm_pending, 2); }
}

/* ===================== In-game overlay (F8) =====================
 * A small Rider panel drawn through the plugin interface's Draw() (which the game calls only with
 * the 3D world on screen: on track, spectating or in a replay). F8 opens and closes it; Up/Down
 * picks a row, Left/Right changes the paint (shown at once on your rider and bike, first person
 * included); Enter saves: the plugin writes mxbm_overlay_save.json and CoreMX queues the change
 * like Apply does while the game runs (written to the profile when MX Bikes closes, shared with
 * other riders straight away). Options are the paints installed for your current bike, rider
 * model, boots and helmet, read from the game's own lists. Text uses the game's own font
 * (ui\main.fnt, copied to plugins\mxbm_data\main.fnt and registered in DrawInit; a plugin can
 * draw text only with a font it registers). Keys are read only while the game window is in front;
 * the game still sees them too. */
typedef struct { float m_aafPos[4][2]; int m_iSprite; unsigned long m_ulColor; } SPluginQuad_t;
typedef struct { char m_szString[100]; float m_afPos[2]; int m_iFont; float m_fSize; int m_iJustify; unsigned long m_ulColor; } SPluginString_t;
/* Rows. Paint rows list the paints installed for the model named in the record (MOFF); model
 * rows (helmet, boots, chest protector/neck brace) list every installed model of that kind.
 * A model change needs your rider rebuilt, which the plugin does when you are back in the pits
 * (the game cannot rebuild your own rider safely while you ride): the old look is removed with
 * the game's RVA 0x4E0D0 and the build state set to 3, which makes the game's loop build it with
 * its full builder RVA 0x45020 (outside and first-person models), as for a postponed first build.
 * Until then, paints of a changed model are not previewed (they would land on the old model). */
#define OV_ROWS 10
#define OV_MAXOPT 400
enum { R_BIKEPAINT, R_SUIT, R_GLOVES, R_BOOTSPAINT, R_HELMETPAINT, R_GOGGLES, R_HELMET, R_BOOTS, R_PROT, R_PROTPAINT };
static const char *const OV_LABEL[OV_ROWS] = { "Bike livery", "Suit", "Gloves", "Boots paint", "Helmet paint", "Goggles", "Helmet", "Boots", "Chest protector / neck brace", "Protector paint" };
static const char *const OV_SLOT[OV_ROWS] = { "bikePaint", "suitPaint", "glovesPaint", "bootsPaint", "helmetPaint", "gogglesPaint", "helmet", "boots", "protection", "protectionPaint" };
static const int OV_OFF[OV_ROWS] = { 0x90, 0x170, 0x1F0, 0x1D0, 0x110, 0x130, 0xF0, 0x1B0, 0x210, 0x230 };
/* Repaint group of a paint row (0 = model row, 16 = needs a rebuild). */
static const int OV_GROUP[OV_ROWS] = { 1, 2, 2, 4, 8, 8, 0, 0, 0, 16 };
/* For paint rows: the model whose paints they list (record offset) and the model row it belongs to. */
static const int OV_MOFF[OV_ROWS] = { 0x30, 0xD0, 0xD0, 0x1B0, 0xF0, 0xF0, 0, 0, 0, 0x210 };
static const int OV_PARENT[OV_ROWS] = { -1, -1, -1, R_BOOTS, R_HELMET, R_HELMET, -1, -1, -1, R_PROT };
static char g_ovOpt[OV_ROWS][OV_MAXOPT][64];
static int g_ovCount[OV_ROWS], g_ovSel[OV_ROWS], g_ovOpen = 0, g_ovFont = 0;
static volatile LONG g_ovDirty = 0;
static volatile LONG g_ownRebuild = 0;  /* a model change waits for the pits */
static int g_ovModelChanged[OV_ROWS];   /* model rows changed since the overlay opened */
static unsigned long long g_ovMsgUntil = 0;

static const GameList *ovPaintList(int row) {
  static const GameList *const PL[OV_ROWS] = { &P_BIKE, &P_SUIT, &P_GLOVES, &P_BOOTS, &P_HELMET, &P_GOGGLES, 0, 0, 0, &P_PROT };
  return PL[row];
}
static const GameList *ovModelList(int row) {
  switch (row) {
    case R_BIKEPAINT: return &L_BIKES;
    case R_SUIT: case R_GLOVES: return &L_RIDERS;
    case R_BOOTSPAINT: case R_BOOTS: return &L_BOOTS;
    case R_HELMETPAINT: case R_GOGGLES: case R_HELMET: return &L_HELMETS;
    default: return &L_PROT;
  }
}

/* Fills one row's options from the game's lists and finds the selected one. */
static void ovLoadRow(unsigned char *base, unsigned char *r, int row) {
  static unsigned char e[0x18C];
  char cur[33]; int n = 0, i; const unsigned char *p = 0;
  memcpy(cur, r + OV_OFF[row], 32); cur[32] = 0;
  g_ovCount[row] = 0; g_ovSel[row] = -1;
  if (OV_GROUP[row] == 0) {
    const GameList *l = ovModelList(row);
    if (row == R_PROT) { copy(g_ovOpt[row][0], "None", 64); if (!cur[0]) g_ovSel[row] = 0; g_ovCount[row] = 1; }
    if (!srvCopy(base + l->count, &n, 4) || !srvCopy(base + l->ptr, (void *)&p, sizeof p) || n <= 0 || n > 20000 || !p) return;
    for (i = 0; i < n && g_ovCount[row] < OV_MAXOPT; i++) {
      char *o = g_ovOpt[row][g_ovCount[row]];
      if (!srvCopy(p + (size_t)i * l->stride, o, 63)) break;
      o[63] = 0;
      if (!o[0]) continue;
      if (_stricmp(o, cur) == 0) g_ovSel[row] = g_ovCount[row];
      g_ovCount[row]++;
    }
    return;
  }
  {
    const GameList *pl = ovPaintList(row); char model[33]; int owner;
    memcpy(model, r + OV_MOFF[row], 32); model[32] = 0;
    owner = modelIndex(base, *ovModelList(row), model);
    if (owner < 0 || !srvCopy(base + pl->count, &n, 4) || !srvCopy(base + pl->ptr, (void *)&p, sizeof p) || n <= 0 || n > 100000 || !p) return;
    for (i = 0; i < n && g_ovCount[row] < OV_MAXOPT; i++) {
      if (!srvCopy(p + (size_t)i * 0x18C, e, sizeof e) || *(int *)e != owner) continue;
      memcpy(g_ovOpt[row][g_ovCount[row]], e + 4, 63); g_ovOpt[row][g_ovCount[row]][63] = 0;
      if (_stricmp(g_ovOpt[row][g_ovCount[row]], cur) == 0) g_ovSel[row] = g_ovCount[row];
      g_ovCount[row]++;
    }
  }
}
static void ovLoadOptions(unsigned char *base, unsigned char *r) {
  int row;
  for (row = 0; row < OV_ROWS; row++) { ovLoadRow(base, r, row); g_ovModelChanged[row] = 0; }
}

static void ovSave(unsigned char *r) {
  char o[2048], v[33]; size_t at; int row;
  at = (size_t)sprintf(o, "{\"v\":1,\"at\":%llu,\"bike\":", nowMs());
  memcpy(v, r + 0x30, 32); v[32] = 0; at = jstr(o, at, v, sizeof o - 80);
  memcpy(o + at, ",\"changes\":{", 12); at += 12;
  for (row = 0; row < OV_ROWS; row++) {
    memcpy(v, r + OV_OFF[row], 32); v[32] = 0;
    if (row == R_PROT && !v[0]) copy(v, "None", sizeof v);
    at += (size_t)sprintf(o + at, "%s\"%s\":", row ? "," : "", OV_SLOT[row]);
    at = jstr(o, at, v, sizeof o - 80);
  }
  o[at++] = '}'; o[at++] = '}'; o[at] = 0;
  writeSmall("mxbm_overlay_save.json", o);
}


static char g_ovMsg[100], g_fontName[64];
static SPluginQuad_t g_quads[96];
static SPluginString_t g_strings[64];
static int g_nq, g_ns;

/* Copies the game's font next to the plugin (once) and registers it. */
EXPORT int DrawInit(int *_piNumSprites, char **_pszSpriteName, int *_piNumFonts, char **_pszFontName) {
  char exe[MAX_PATH * 2], me[MAX_PATH * 2], src[MAX_PATH * 2 + 32], dst[MAX_PATH * 2 + 32], *slash; HMODULE self = 0;
  if (_piNumSprites) *_piNumSprites = 0;
  if (_pszSpriteName) *_pszSpriteName = NULL;
  if (_piNumFonts) *_piNumFonts = 0;
  if (_pszFontName) *_pszFontName = NULL;
  if (!_piNumFonts || !_pszFontName) return 0;
  if (!GetModuleFileNameA(NULL, exe, sizeof exe) || !(slash = strrchr(exe, '\\'))) return 0;
  slash[1] = 0;
  if (!GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, (LPCSTR)(void *)DrawInit, &self) ||
      !GetModuleFileNameA(self, me, sizeof me) || !(slash = strrchr(me, '\\'))) return 0;
  slash[1] = 0;
  sprintf(src, "%sui\\main.fnt", exe);
  sprintf(dst, "%smxbm_data", me); CreateDirectoryA(dst, NULL);
  sprintf(dst, "%smxbm_data\\main.fnt", me);
  if (GetFileAttributesA(dst) == INVALID_FILE_ATTRIBUTES && !CopyFileA(src, dst, TRUE)) return 0;
  copy(g_fontName, "mxbm_data\\main.fnt", sizeof g_fontName);
  *_piNumFonts = 1; *_pszFontName = g_fontName; g_ovFont = 1;
  return 0;
}

static void ovQuad(float x0, float y0, float x1, float y1, unsigned long c) {
  SPluginQuad_t *q;
  if (g_nq >= (int)(sizeof g_quads / sizeof g_quads[0])) return;
  q = &g_quads[g_nq++];
  q->m_aafPos[0][0] = x0; q->m_aafPos[0][1] = y0; q->m_aafPos[1][0] = x0; q->m_aafPos[1][1] = y1;
  q->m_aafPos[2][0] = x1; q->m_aafPos[2][1] = y1; q->m_aafPos[3][0] = x1; q->m_aafPos[3][1] = y0;
  q->m_iSprite = 0; q->m_ulColor = c;
}
static void ovText(const char *s, float x, float y, float size, int justify, unsigned long c) {
  SPluginString_t *t;
  if (!g_ovFont || g_ns >= (int)(sizeof g_strings / sizeof g_strings[0])) return;
  t = &g_strings[g_ns++];
  copy(t->m_szString, s, sizeof t->m_szString);
  t->m_afPos[0] = x; t->m_afPos[1] = y; t->m_iFont = g_ovFont; t->m_fSize = size; t->m_iJustify = justify; t->m_ulColor = c;
}

/* Your own vehicle record, if it is built and this game build is the one checked. */
static unsigned char *ownRecord(unsigned char *base) {
  int own = 0; unsigned char *r;
  if (!mxbm_orig_ui || !looksBuildOk(base) || !srvCopy(base + 0xE62710, &own, 4) || own < 1 || own > 50) return 0;
  r = base + 0xF4EE20 + (size_t)(own - 1) * 0x5B24;
  return *(const int *)r == 1 && *(const int *)(r + 0x274) > 0 ? r : 0;
}

static int keyPressed(int vk) {
  static unsigned char down[256];
  int now = (GetAsyncKeyState(vk) & 0x8000) != 0, was = down[vk & 0xFF];
  down[vk & 0xFF] = (unsigned char)now;
  return now && !was;
}
static int gameInFront(void) { DWORD pid = 0; HWND w = GetForegroundWindow(); if (w) GetWindowThreadProcessId(w, &pid); return pid == GetCurrentProcessId(); }

/* Layout, mimicking CoreMX's Rider page: Outfit and Bike tabs, gear grouped like the app (Head,
 * Body, Hands & feet / Bike), a card per slot (label above value), a picker list beside the cards,
 * an orange Save button. Coordinates are fractions of the screen (0..1). The game hides and locks
 * the system cursor while you ride, so the overlay draws its own pointer from the mouse position
 * and reads left clicks while it is open (the game sees the clicks too). Keyboard: Up/Down card,
 * Left/Right change, Tab switch tab, Enter save, F8 close. Locked during Race 1 and Race 2. */
typedef struct { const char *group; int row; } OvCard;
static const OvCard OV_OUTFIT[] = { { "HEAD", R_HELMET }, { NULL, R_HELMETPAINT }, { NULL, R_GOGGLES }, { "BODY", R_SUIT }, { NULL, R_PROT }, { NULL, R_PROTPAINT },
  { "HANDS & FEET", R_GLOVES }, { NULL, R_BOOTS }, { NULL, R_BOOTSPAINT } };
static const OvCard OV_BIKE[] = { { "BIKE", 0 } };
static int g_ovTab = 0, g_ovCard = 0, g_ovPicker = -1, g_ovScroll = 0;
typedef struct { float x0, y0, x1, y1; int kind, value; } OvHit; /* kind: 1 tab, 2 card, 3 option, 4 save, 5 close, 6 scroll */
static OvHit g_ovHits[64]; static int g_ovNHits;
#define OV_ACCENT 0xFF328CFFu   /* orange (ABGR) */
#define OV_PICKER_ROWS 12
#define OV_SAVED_MSG "Saved. Shared with CoreMX riders; written to your profile when MX Bikes closes."

static void ovHit(float x0, float y0, float x1, float y1, int kind, int value) {
  if (g_ovNHits < 64) { OvHit *h = &g_ovHits[g_ovNHits++]; h->x0 = x0; h->y0 = y0; h->x1 = x1; h->y1 = y1; h->kind = kind; h->value = value; }
}
static void ovBox(float x0, float y0, float x1, float y1, float t, unsigned long c) {
  ovQuad(x0, y0, x1, y0 + t, c); ovQuad(x0, y1 - t, x1, y1, c); ovQuad(x0, y0, x0 + t, y1, c); ovQuad(x1 - t, y0, x1, y1, c);
}
static void ovTri(float ax, float ay, float bx, float by, float cx, float cy, unsigned long c) {
  SPluginQuad_t *q;
  if (g_nq >= (int)(sizeof g_quads / sizeof g_quads[0])) return;
  q = &g_quads[g_nq++];
  q->m_aafPos[0][0] = ax; q->m_aafPos[0][1] = ay; q->m_aafPos[1][0] = bx; q->m_aafPos[1][1] = by;
  q->m_aafPos[2][0] = cx; q->m_aafPos[2][1] = cy; q->m_aafPos[3][0] = cx; q->m_aafPos[3][1] = cy;
  q->m_iSprite = 0; q->m_ulColor = c;
}
/* Mouse position as screen fractions, from the game window's client area. */
static int ovMouse(float *mx, float *my) {
  POINT p; RECT rc; HWND w = GetForegroundWindow();
  if (!w || !GetCursorPos(&p) || !ScreenToClient(w, &p) || !GetClientRect(w, &rc) || rc.right <= 0 || rc.bottom <= 0) return 0;
  *mx = (float)p.x / (float)rc.right; *my = (float)p.y / (float)rc.bottom;
  return 1;
}
static int ovRaceLocked(void) { return S.type == 2 && (S.session == 6 || S.session == 7); }
static void ovSetValue(unsigned char *base, unsigned char *r, int row, int sel) {
  int k;
  g_ovSel[row] = sel;
  setName(r + OV_OFF[row], row == R_PROT && sel == 0 ? "" : g_ovOpt[row][sel]);
  if (OV_GROUP[row] == 0) {
    /* A different model: its paint lists change. Keep each paint if the new model has it, else
     * take its first one, so a paint never belongs to another model. Rebuild in the pits. */
    g_ovModelChanged[row] = 1;
    for (k = 0; k < OV_ROWS; k++) {
      if (OV_PARENT[k] != row) continue;
      ovLoadRow(base, r, k);
      if (g_ovSel[k] < 0) { setName(r + OV_OFF[k], g_ovCount[k] ? g_ovOpt[k][0] : ""); g_ovSel[k] = g_ovCount[k] ? 0 : -1; }
    }
    InterlockedExchange(&g_ownRebuild, 1);
  } else if (OV_GROUP[row] == 16 || (OV_PARENT[row] >= 0 && g_ovModelChanged[OV_PARENT[row]])) {
    InterlockedExchange(&g_ownRebuild, 1);   /* drawn by the rebuild, not previewed on the old model */
  } else {
    InterlockedOr(&g_ovDirty, OV_GROUP[row]);
    InterlockedOr(&mxbm_pending, 4);
  }
}
static void ovStep(unsigned char *base, unsigned char *r, int row, int dir) {
  int c = g_ovCount[row], s = g_ovSel[row];
  if (c <= 0) return;
  ovSetValue(base, r, row, s < 0 ? 0 : (s + (dir > 0 ? 1 : c - 1)) % c);
}
static void ovSaveNow(unsigned char *r) { ovSave(r); copy(g_ovMsg, OV_SAVED_MSG, sizeof g_ovMsg); g_ovMsgUntil = nowMs() + 5000; }

EXPORT void Draw(int _iState, int *_piNumQuads, void **_ppQuad, int *_piNumString, void **_ppString) {
  unsigned char *base = (unsigned char *)GetModuleHandleA(NULL), *r;
  const OvCard *cards; int ncards, f8, up, dn, lt, rt, en, tab, click, locked, i;
  float mx = -1, my = -1;
  (void)_iState;
  g_nq = g_ns = 0;
  if (_piNumQuads) *_piNumQuads = 0;
  if (_piNumString) *_piNumString = 0;
  if (!gameInFront()) return;
  f8 = keyPressed(VK_F8); up = keyPressed(VK_UP); dn = keyPressed(VK_DOWN); lt = keyPressed(VK_LEFT); rt = keyPressed(VK_RIGHT);
  en = keyPressed(VK_RETURN); tab = keyPressed(VK_TAB); click = keyPressed(VK_LBUTTON);
  r = S.inEvent ? ownRecord(base) : 0;
  if (f8) {
    g_ovOpen = !g_ovOpen; g_ovPicker = -1; g_ovMsgUntil = 0;
    if (g_ovOpen && r) ovLoadOptions(base, r);
    if (g_ovOpen) ClipCursor(NULL);
  }
  if (!g_ovOpen) return;
  locked = ovRaceLocked();
  cards = g_ovTab ? OV_BIKE : OV_OUTFIT; ncards = g_ovTab ? 1 : (int)(sizeof OV_OUTFIT / sizeof OV_OUTFIT[0]);
  if (g_ovCard >= ncards) g_ovCard = 0;
  ovMouse(&mx, &my);

  /* Input (hit areas are from the previous frame; the layout does not move between frames). */
  if (tab) { g_ovTab = !g_ovTab; g_ovCard = 0; g_ovPicker = -1; }
  cards = g_ovTab ? OV_BIKE : OV_OUTFIT; ncards = g_ovTab ? 1 : (int)(sizeof OV_OUTFIT / sizeof OV_OUTFIT[0]);
  if (r && !locked) {
    if (g_ovPicker >= 0) {
      int c = g_ovCount[g_ovPicker];
      if (up && c) ovSetValue(base, r, g_ovPicker, (g_ovSel[g_ovPicker] + c - 1) % c);
      if (dn && c) ovSetValue(base, r, g_ovPicker, (g_ovSel[g_ovPicker] + 1) % c);
    } else {
      if (up) g_ovCard = (g_ovCard + ncards - 1) % ncards;
      if (dn) g_ovCard = (g_ovCard + 1) % ncards;
    }
    if (lt || rt) ovStep(base, r, cards[g_ovCard].row, rt ? 1 : -1);
    if (en) ovSaveNow(r);
  }
  if (click) {
    for (i = g_ovNHits - 1; i >= 0; i--) {
      const OvHit *h = &g_ovHits[i];
      if (mx < h->x0 || mx > h->x1 || my < h->y0 || my > h->y1) continue;
      if (h->kind == 1) { g_ovTab = h->value; g_ovCard = 0; g_ovPicker = -1; }
      else if (h->kind == 5) { g_ovOpen = 0; return; }
      else if (r && !locked) {
        if (h->kind == 2) {
          int row = cards[h->value].row;
          g_ovCard = h->value; g_ovPicker = g_ovPicker == row ? -1 : row;
          g_ovScroll = g_ovSel[row] > OV_PICKER_ROWS / 2 ? g_ovSel[row] - OV_PICKER_ROWS / 2 : 0;
        }
        else if (h->kind == 3 && g_ovPicker >= 0) ovSetValue(base, r, g_ovPicker, h->value);
        else if (h->kind == 6 && g_ovPicker >= 0) g_ovScroll += h->value * (OV_PICKER_ROWS - 1);
        else if (h->kind == 4) ovSaveNow(r);
      }
      break;
    }
    cards = g_ovTab ? OV_BIKE : OV_OUTFIT; ncards = g_ovTab ? 1 : (int)(sizeof OV_OUTFIT / sizeof OV_OUTFIT[0]);
  }
  if (g_ovPicker >= 0) {
    int c = g_ovCount[g_ovPicker], s = g_ovSel[g_ovPicker];
    if (s >= 0 && (up || dn)) { if (s < g_ovScroll) g_ovScroll = s; if (s >= g_ovScroll + OV_PICKER_ROWS) g_ovScroll = s - OV_PICKER_ROWS + 1; }
    if (g_ovScroll > c - OV_PICKER_ROWS) g_ovScroll = c - OV_PICKER_ROWS;
    if (g_ovScroll < 0) g_ovScroll = 0;
  }

  /* Drawing. */
  g_ovNHits = 0;
  {
    const float x0 = 0.03f, x1 = 0.33f, y0 = 0.12f;
    float y = y0 + 0.13f, y1;
    char line[100];
    int k, groups = 0;
    for (k = 0; k < ncards; k++) if (cards[k].group) groups++;
    y1 = y + groups * 0.030f + ncards * 0.052f + 0.15f;
    ovQuad(x0, y0, x1, y1, 0xE6141418);
    ovBox(x0, y0, x1, y1, 0.0015f, 0x30FFFFFF);
    ovText("CoreMX", x0 + 0.014f, y0 + 0.016f, 0.018f, 0, OV_ACCENT);
    ovText("Rider", x0 + 0.014f, y0 + 0.040f, 0.034f, 0, 0xFFFFFFFF);
    /* Tabs (pills). */
    for (k = 0; k < 2; k++) {
      float tx0 = x0 + 0.014f + k * 0.075f, tx1 = tx0 + 0.068f, ty0 = y0 + 0.085f, ty1 = ty0 + 0.034f;
      ovQuad(tx0, ty0, tx1, ty1, k == g_ovTab ? 0xEBFFFFFF : 0x14FFFFFF);
      ovText(k ? "Bike" : "Outfit", (tx0 + tx1) / 2, ty0 + 0.008f, 0.017f, 1, k == g_ovTab ? 0xFF100D0C : 0xFFD0D0D0);
      ovHit(tx0, ty0, tx1, ty1, 1, k);
    }
    /* Close (x). */
    ovText("x", x1 - 0.016f, y0 + 0.014f, 0.022f, 2, 0xFFB0B0B0);
    ovHit(x1 - 0.03f, y0 + 0.008f, x1 - 0.004f, y0 + 0.04f, 5, 0);
    if (!r) ovText("Ride out on track to change your gear here.", x0 + 0.014f, y, 0.017f, 0, 0xFFB0B0B0);
    else for (k = 0; k < ncards; k++) {
      int row = cards[k].row, sel = g_ovSel[row], c = g_ovCount[row], on = k == g_ovCard;
      char cur[33];
      if (cards[k].group) { ovText(cards[k].group, x0 + 0.014f, y, 0.0135f, 0, 0xFF8C8C8C); y += 0.030f; }
      ovQuad(x0 + 0.010f, y, x1 - 0.010f, y + 0.046f, row == g_ovPicker ? 0x40328CFF : on ? 0x24FFFFFF : 0x12FFFFFF);
      if (on || row == g_ovPicker) ovBox(x0 + 0.010f, y, x1 - 0.010f, y + 0.046f, 0.0018f, row == g_ovPicker ? OV_ACCENT : 0x50FFFFFF);
      ovText(OV_LABEL[row], x0 + 0.020f, y + 0.005f, 0.0135f, 0, 0xFF9A9A9A);
      memcpy(cur, r + OV_OFF[row], 32); cur[32] = 0;
      sprintf(line, "%.42s", sel >= 0 ? g_ovOpt[row][sel] : cur[0] ? cur : c ? "Default" : "None installed");
      ovText(line, x0 + 0.020f, y + 0.021f, 0.017f, 0, 0xFFFFFFFF);
      if (c > 1) ovText("<  >", x1 - 0.022f, y + 0.015f, 0.017f, 2, 0xFFB0B0B0);
      ovHit(x0 + 0.010f, y, x1 - 0.010f, y + 0.046f, 2, k);
      y += 0.052f;
    }
    /* Save button and status. */
    y = y1 - 0.105f;
    if (r && !locked && g_ownRebuild)
      ovText(S.onTrack ? "Helmet, boots and protector changes show when you go back to the pits." : "Applying your new helmet, boots or protector...",
             x0 + 0.014f, y - 0.030f, 0.0135f, 0, 0xFF6CB4FF);
    if (r && !locked) {
      ovQuad(x0 + 0.014f, y, x1 - 0.014f, y + 0.042f, OV_ACCENT);
      ovText("Save", (x0 + x1) / 2, y + 0.011f, 0.019f, 1, 0xFFFFFFFF);
      ovHit(x0 + 0.014f, y, x1 - 0.014f, y + 0.042f, 4, 0);
    }
    if (locked) ovText("Locked during the race. Change gear in practice, warm-up or testing.", x0 + 0.014f, y + 0.012f, 0.0145f, 0, 0xFF6CB4FF);
    else if (g_ovMsgUntil > nowMs()) ovText(g_ovMsg, x0 + 0.014f, y + 0.052f, 0.0125f, 0, 0xFF6CE07A);
    ovText("Click or Up/Down, Left/Right   Tab switch   Enter save   F8 close", x0 + 0.014f, y1 - 0.026f, 0.0125f, 0, 0xFF808080);

    /* Picker beside the panel. */
    if (r && !locked && g_ovPicker >= 0) {
      const float px0 = x1 + 0.008f, px1 = px0 + 0.22f, py0 = y0, rowH = 0.034f;
      int c = g_ovCount[g_ovPicker], shown = c < OV_PICKER_ROWS ? c : OV_PICKER_ROWS;
      float py1 = py0 + 0.06f + shown * rowH + 0.05f;
      ovQuad(px0, py0, px1, py1, 0xE6141418);
      ovBox(px0, py0, px1, py1, 0.0015f, 0x30FFFFFF);
      sprintf(line, "%s  (%d)", OV_LABEL[g_ovPicker], c);
      ovText(line, px0 + 0.012f, py0 + 0.018f, 0.017f, 0, 0xFFFFFFFF);
      for (k = 0; k < shown; k++) {
        int opt = g_ovScroll + k; float oy = py0 + 0.055f + k * rowH;
        if (opt >= c) break;
        if (opt == g_ovSel[g_ovPicker]) ovQuad(px0 + 0.006f, oy - 0.003f, px1 - 0.006f, oy + rowH - 0.005f, 0x60328CFF);
        sprintf(line, "%.40s", g_ovOpt[g_ovPicker][opt]);
        ovText(line, px0 + 0.014f, oy + 0.004f, 0.0155f, 0, opt == g_ovSel[g_ovPicker] ? 0xFFFFFFFF : 0xFFC8C8C8);
        ovHit(px0 + 0.006f, oy - 0.003f, px1 - 0.006f, oy + rowH - 0.005f, 3, opt);
      }
      if (c > OV_PICKER_ROWS) {
        float by = py1 - 0.042f;
        ovText("^ up", px0 + 0.014f, by + 0.008f, 0.015f, 0, g_ovScroll > 0 ? 0xFFD0D0D0 : 0xFF606060);
        ovHit(px0 + 0.006f, by, (px0 + px1) / 2, by + 0.034f, 6, -1);
        ovText("down v", px1 - 0.014f, by + 0.008f, 0.015f, 2, g_ovScroll + OV_PICKER_ROWS < c ? 0xFFD0D0D0 : 0xFF606060);
        ovHit((px0 + px1) / 2, by, px1 - 0.006f, by + 0.034f, 6, 1);
      }
    }
    /* Pointer: a white arrow with a dark edge. */
    if (mx >= 0 && my >= 0 && mx <= 1 && my <= 1) {
      ovTri(mx - 0.002f, my - 0.003f, mx - 0.002f, my + 0.032f, mx + 0.021f, my + 0.022f, 0xFF000000);
      ovTri(mx, my, mx, my + 0.026f, mx + 0.016f, my + 0.019f, 0xFFFFFFFF);
    }
  }
  if (_piNumQuads && _ppQuad) { *_piNumQuads = g_nq; *_ppQuad = g_quads; }
  if (_piNumString && _ppString) { *_piNumString = g_ns; *_ppString = g_strings; }
}

/* The full builder's first bytes, the own-vehicle setup's call to it and the rebuild loop's tyre
 * lookup must match this game build before your rider is rebuilt. */
static const unsigned char SIG_BUILD_FULL[16] = { 0x48, 0x89, 0x5c, 0x24, 0x18, 0x55, 0x56, 0x57, 0x41, 0x54, 0x41, 0x55, 0x41, 0x56, 0x41, 0x57 };
static int ownRebuildOk(const unsigned char *base) {
  static int ok = -1;
  if (ok < 0) ok = looksBuildOk(base) && memcmp(base + 0x45020, SIG_BUILD_FULL, sizeof SIG_BUILD_FULL) == 0 &&
                   fnv(base + 0x66E80, 0x66F79 - 0x66E80) == 0xcad4fd30u && fnv(base + 0x6EC90, 0x6ECC1 - 0x6EC90) == 0x655fa390u;
  return ok;
}

/* Runs on the game's main thread, from the UI stub. */
void mxbm_run_pending(void) {
  LONG work = InterlockedExchange(&mxbm_pending, 0);
  if (work & 1) runPaintTest();
  if (work & 2) applyLooks();
  if (work & 8) {
    /* Your own rider with a new helmet, boots or protector, once you are back in the pits: remove
     * the old look (RVA 0x4E0D0), then build it again the way your own vehicle's setup does
     * (RVA 0x66A27 at 0x66F74): the full builder RVA 0x45020 with flags 0, which builds the
     * outside and the first-person ("cockpit/") models and marks the first-person set (+0x3BC).
     * (The game's rebuild loop passes flags 4, no first-person set: right for other riders, but
     * for you it left the outside helmet and protector in the first-person view.) The tyre
     * argument is the index of the record's tyre name (+0x70) in the tyre list, as the loop
     * computes it. Checked against this game build's bytes first. */
    unsigned char *base = (unsigned char *)GetModuleHandleA(NULL), *r = ownRecord(base);
    if (r && g_ownRebuild && !S.onTrack && *(const int *)(r + 0x4EE8) == 0 && ownRebuildOk(base)) {
      static const GameList L_TYRES = { 0x109DECC, 0xF48618, 0x608 };
      char bike[33], tyres[33], num[16];
      int bikeIndex, tyreIndex;
      memcpy(bike, r + 0x30, 32); bike[32] = 0; memcpy(tyres, r + 0x70, 32); tyres[32] = 0;
      bikeIndex = modelIndex(base, L_BIKES, bike); tyreIndex = modelIndex(base, L_TYRES, tyres);
      InterlockedExchange(&g_ownRebuild, 0);
      if (bikeIndex >= 0 && tyreIndex >= 0) {
        typedef int (*build_full_t)(unsigned char *block, int bike, int tyre, const char *bikePaint, const char *b0, const char *rider,
                                    const char *helmet, const char *helmetPaint, const char *goggles, const char *helmetCam, const char *suit,
                                    const char *suitFont, const char *boots, const char *bootsPaint, const char *gloves, const char *prot,
                                    const char *protPaint, const char *f250, const char *raceNumber, const char *name, int flags);
        const char *R = (const char *)r;
        sprintf(num, "%d", *(const int *)(r + 0x0C));
        g_gameCallThread = GetCurrentThreadId();
        ((int (*)(unsigned char *))(void *)(base + 0x4E0D0))(r + 0x274);
        ((build_full_t)(void *)(base + 0x45020))(r + 0x274, bikeIndex, tyreIndex, R + 0x90, R + 0xB0, R + 0xD0, R + 0xF0, R + 0x110, R + 0x130,
                                                 R + 0x150, R + 0x170, R + 0x190, R + 0x1B0, R + 0x1D0, R + 0x1F0, R + 0x210, R + 0x230, R + 0x250,
                                                 num, R + 0x10, 0);
        g_gameCallThread = 0;
      }
    }
  }
  if (work & 4) {
    unsigned char *base = (unsigned char *)GetModuleHandleA(NULL), *r = ownRecord(base);
    LONG groups = InterlockedExchange(&g_ovDirty, 0);
    if (r && groups && *(const int *)(r + 0x4EE8) == 0) {
      g_gameCallThread = GetCurrentThreadId();
      repaintGroups(base, (dispatch_t)mxbm_orig_ui, r, (int)groups);
      g_gameCallThread = 0;
    }
  }
}

static void serverListStart(void) {
  const unsigned char *base = (const unsigned char *)GetModuleHandleA(NULL);
  IMAGE_NT_HEADERS *nt;
  if (!base || ((IMAGE_DOS_HEADER *)base)->e_magic != IMAGE_DOS_SIGNATURE) return;
  nt = (IMAGE_NT_HEADERS *)(base + ((IMAGE_DOS_HEADER *)base)->e_lfanew);
  if (nt->OptionalHeader.SizeOfImage < RVA_SRV_COUNT + 8) return;
  /* .text is decrypted once the game runs its own code, which happens before plugins load. */
  if (memcmp(base + RVA_SIG, SIG, sizeof SIG) != 0 && memcmp(base + RVA_SIG2, SIG2, sizeof SIG2) != 0) return;
  g_srvStop = 0;
  g_srvThread = CreateThread(NULL, 0, serverListThread, NULL, 0, NULL);
}
static void serverListStop(void) {
  InterlockedExchange(&g_srvStop, 1);
  if (g_srvThread) { WaitForSingleObject(g_srvThread, 2000); CloseHandle(g_srvThread); g_srvThread = 0; }
}

static void hookStart(const char *dir) {
  HMODULE self = 0;
  copy(g_dir, dir, sizeof g_dir);
  serverListStart(); /* reads only, so it runs even when the hook is switched off */
  if (disabledForThisBuild()) { hookState("disabled", "Switched off after MX Bikes crashed inside the plugin"); return; }
  if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, (LPCSTR)(void *)hookStart, &self)) {
    IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)((unsigned char *)self + ((IMAGE_DOS_HEADER *)self)->e_lfanew);
    g_selfBase = (unsigned char *)self; g_selfSize = nt->OptionalHeader.SizeOfImage;
  }
  g_veh = AddVectoredExceptionHandler(1, onCrash);
  g_hookStop = 0;
  g_hookThread = CreateThread(NULL, 0, hookThread, NULL, 0, NULL);
}

static void hookStop(void) {
  InterlockedExchange(&g_hookStop, 1);
  serverListStop();
  stunStop();
  if (g_hookThread) { WaitForSingleObject(g_hookThread, 2000); CloseHandle(g_hookThread); g_hookThread = 0; }
  if (g_slot && mxbm_orig_ui) InterlockedCompareExchangePointer((PVOID *)g_slot, mxbm_orig_ui, (PVOID)mxbm_ui_stub);
  if (g_veh) { RemoveVectoredExceptionHandler(g_veh); g_veh = 0; }
}

BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID r) { (void)h; (void)reason; (void)r; return TRUE; }

/* Polled from the server-list thread: a waiting model change runs once you are in the pits. */
static void ownRebuildPoll(void) {
  if (g_ownRebuild && mxbm_orig_ui && S.inEvent && !S.onTrack) InterlockedOr(&mxbm_pending, 8);
}
