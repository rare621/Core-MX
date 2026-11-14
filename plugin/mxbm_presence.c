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
#include <windows.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

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
  at += (size_t)sprintf(o, "{\"v\":1,\"pid\":%lu,\"updated\":%llu", GetCurrentProcessId(), (t.QuadPart - 116444736000000000ULL) / 10000ULL);
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
    if (S.haveServer) { PUTS("server", S.server); PUTI("serverType", S.serverType); PUTS("guid", S.guid); }
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

/* _szSavePath is the game's user folder (Documents\PiBoSo\MX Bikes\). -1 = no telemetry needed. */
EXPORT int Startup(char *_szSavePath) {
  size_t n;
  InitializeCriticalSection(&g_lock); g_lockReady = 1;
  copy(g_path, _szSavePath ? _szSavePath : "", sizeof g_path - 40);
  n = strlen(g_path);
  if (n && g_path[n - 1] != '\\' && g_path[n - 1] != '/') g_path[n++] = '\\', g_path[n] = 0;
  strcpy(g_tmp, g_path); strcat(g_tmp, "mxbm_presence.tmp");
  strcat(g_path, "mxbm_presence.json");
  memset(&S, 0, sizeof S);
  writeState();
  return -1;
}

EXPORT void Shutdown(void) {
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
  S.haveServer = _iDataSize >= (int)(offsetof(BikeEvent, m_szGUID) + sizeof e->m_szGUID);
  if (S.haveServer) {
    copy(S.server, e->m_szServerName, sizeof S.server);
    copy(S.guid, e->m_szGUID, sizeof S.guid);
    S.serverType = e->m_iServerType;
  }
  writeState();
  unlock();
}

EXPORT void EventDeinit(void) { lock(); memset(&S, 0, sizeof S); writeState(); unlock(); }

EXPORT void RaceEvent(void *_pData, int _iDataSize) {
  const RaceEventData *e = (const RaceEventData *)_pData;
  if (!e || _iDataSize < (int)sizeof(RaceEventData) - (int)sizeof(float)) return;
  lock();
  copy(S.eventName, e->m_szName, sizeof S.eventName);
  if (!S.trackName[0]) copy(S.trackName, e->m_szTrackName, sizeof S.trackName);
  writeState();
  unlock();
}

EXPORT void RaceDeinit(void) { lock(); memset(S.riders, 0, sizeof S.riders); S.eventName[0] = 0; writeState(); unlock(); }

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

BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID r) { (void)h; (void)reason; (void)r; return TRUE; }
