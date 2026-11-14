# Requires git and Zig 0.17.1 on PATH. Builds the MIT-licensed plugin from pinned sources.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
  $source = '.tmp/frostmod-src'
  $minhook = '.tmp/minhook'
  if (-not (Test-Path "$source/.git")) {
    git clone --branch v0.52.0 --depth 1 https://github.com/Frostn1/frostmod.git $source
    if ($LASTEXITCODE) { throw 'FrostMod clone failed' }
  }
  if (-not (Test-Path "$minhook/.git")) {
    git clone --branch v1.3.4 --depth 1 https://github.com/TsudaKageyu/minhook.git $minhook
    if ($LASTEXITCODE) { throw 'MinHook clone failed' }
  }
  if ((git -C $source rev-parse HEAD) -ne 'fe1614ddbc294faba93e914697ae98bd89f494db') { throw 'Unexpected FrostMod revision' }
  if ((git -C $minhook rev-parse HEAD) -ne 'c3fcafdc10146beb5919319d0683e44e3c30d537') { throw 'Unexpected MinHook revision' }
  $patch = Join-Path $repoRoot 'plugin/frostmod/automatic-discovery.patch'
  git -C $source apply --reverse --check $patch 2>$null
  if ($LASTEXITCODE) {
    git -C $source apply --check $patch
    if ($LASTEXITCODE) { throw 'Source has unrelated edits; use a clean pinned checkout' }
    git -C $source apply $patch
    if ($LASTEXITCODE) { throw 'Patch failed' }
  }
  $env:ZIG_GLOBAL_CACHE_DIR = Join-Path $repoRoot '.tmp/zig-cache'
  $env:SOURCE_DATE_EPOCH = '1794614400'
  foreach ($part in @('buffer','hook','trampoline','hde/hde64')) {
    $objectName = $part -replace '/', '-'
    zig cc -target x86_64-windows-gnu -O2 -c "$minhook/src/$part.c" -o ".tmp/$objectName.o"
    if ($LASTEXITCODE) { throw 'MinHook compilation failed' }
  }
  zig c++ -target x86_64-windows-gnu -std=c++17 -fms-extensions -Wno-date-time -O2 -shared -I "$minhook/include" "$source/src/frostmod.cpp" "$source/src/serverfilter.cpp" "$source/src/crashreport.cpp" "$source/src/nantrap.cpp" .tmp/buffer.o .tmp/hook.o .tmp/trampoline.o .tmp/hde-hde64.o -lgdi32 -luser32 -lopengl32 -lwinhttp -lpsapi -lws2_32 -o .tmp/frostmod-fixed.dll
  if ($LASTEXITCODE) { throw 'FrostMod compilation failed' }
  zig c++ -target x86_64-windows-gnu -std=c++17 "$source/tests/masterlist_test.cpp" -o .tmp/frostmod-masterlist-test.exe
  if ($LASTEXITCODE) { throw 'Masterlist test compilation failed' }
  & ./.tmp/frostmod-masterlist-test.exe
  if ($LASTEXITCODE) { throw 'Masterlist tests failed' }
  Write-Output 'Built .tmp/frostmod-fixed.dll. Verify before updating the bundled binary and release.json.'
} finally { Pop-Location }
