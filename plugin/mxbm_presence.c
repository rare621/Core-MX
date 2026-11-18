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
static void stunStart(unsigned char *base);
static void stunStop(void);
static void stunUnhook(void);

static char g_path[MAX_PATH * 2];
static char g_tmp[MAX_PATH * 2];
static CRITICAL_SECTION g_lock;
static int g_lockReady;

static struct {
  int inEvent, type, serverType, session, haveServer;
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
#define HOOK_BUILD 3
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

__asm__(
  ".intel_syntax noprefix\n"
  ".text\n"
  ".globl mxbm_ui_stub\n"
  "mxbm_ui_stub:\n"
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
static LONG CALLBACK onCrash(EXCEPTION_POINTERS *e) {
  DWORD code = e->ExceptionRecord->ExceptionCode;
  unsigned char *ip = (unsigned char *)e->ExceptionRecord->ExceptionAddress;
  if (code != EXCEPTION_ACCESS_VIOLATION && code != EXCEPTION_ILLEGAL_INSTRUCTION && code != EXCEPTION_STACK_OVERFLOW && code != EXCEPTION_PRIV_INSTRUCTION) return EXCEPTION_CONTINUE_SEARCH;
  if (!g_selfBase || ip < g_selfBase || ip >= g_selfBase + g_selfSize) return EXCEPTION_CONTINUE_SEARCH;
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

static void hookStart(const char *dir) {
  HMODULE self = 0;
  copy(g_dir, dir, sizeof g_dir);
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
  stunStop();
  if (g_hookThread) { WaitForSingleObject(g_hookThread, 2000); CloseHandle(g_hookThread); g_hookThread = 0; }
  if (g_slot && mxbm_orig_ui) InterlockedCompareExchangePointer((PVOID *)g_slot, mxbm_orig_ui, (PVOID)mxbm_ui_stub);
  if (g_veh) { RemoveVectoredExceptionHandler(g_veh); g_veh = 0; }
}

BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID r) { (void)h; (void)reason; (void)r; return TRUE; }
