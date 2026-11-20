// Windows Firewall and hosting. When MX Bikes first hosts, Windows asks whether to let it in; Cancel
// (or "Private networks" while the PC's network is Public) leaves a rule that silently drops every
// rider trying to join, even with the router port open. CoreMX reads the firewall (no admin needed)
// and, when the player clicks "Allow MX Bikes", adds an inbound allow rule through Windows' own
// administrator prompt.
const { execFile } = require('child_process');
const path = require('path');

const RULE_NAME = 'MX Bikes (CoreMX hosting)';
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function powershell(script, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout || ''));
    });
  });
}

// Reads the firewall profiles, the network types in use and the inbound rules for the game's exe.
async function read(exe) {
  const script = `$ErrorActionPreference='SilentlyContinue'
$p = Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; enabled = [string]$_.Enabled; inbound = [string]$_.DefaultInboundAction } }
$c = @(Get-NetConnectionProfile | ForEach-Object { [string]$_.NetworkCategory })
$exe = ${psQuote(exe)}
$r = @(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and ([Environment]::ExpandEnvironmentVariables($_.Program) -ieq $exe -or (Split-Path $_.Program -Leaf) -ieq 'mxbikes.exe') } | ForEach-Object {
  $rule = $_ | Get-NetFirewallRule; $port = $rule | Get-NetFirewallPortFilter
  if ($rule.Direction -eq 'Inbound') { @{ name = [string]$rule.DisplayName; action = [string]$rule.Action; enabled = [string]$rule.Enabled; profile = [string]$rule.Profile; protocol = [string]$port.Protocol } } })
@{ profiles = @($p); categories = $c; rules = $r } | ConvertTo-Json -Depth 4 -Compress`;
  return JSON.parse((await powershell(script)).trim() || '{}');
}

// { state: 'off' | 'allowed' | 'blocked' | 'unknown', detail }.
function evaluate(data) {
  const profiles = (data && data.profiles) || [], cats = [].concat((data && data.categories) || []).map((c) => String(c).toLowerCase());
  if (!profiles.length) return { state: 'unknown', detail: 'Windows Firewall could not be read' };
  // DomainAuthenticated is the Domain profile.
  const inUse = new Set((cats.length ? cats : ['public']).map((c) => (c.startsWith('domain') ? 'domain' : c)));
  const on = profiles.filter((p) => inUse.has(String(p.name).toLowerCase()) && /true/i.test(p.enabled));
  if (!on.length) return { state: 'off', detail: 'Windows Firewall is off for this network' };
  const covers = (r) => /any/i.test(r.profile) || String(r.profile).toLowerCase().split(/[,\s]+/).some((x) => inUse.has(x));
  const udp = (r) => !r.protocol || /any|udp/i.test(r.protocol);
  const rules = [].concat((data && data.rules) || []).filter((r) => /true/i.test(r.enabled) && covers(r) && udp(r));
  const network = [...inUse].map((c) => c[0].toUpperCase() + c.slice(1)).join(' / ');
  if (rules.some((r) => /block/i.test(r.action))) return { state: 'blocked', detail: `A Windows Firewall rule blocks MX Bikes on your ${network} network` };
  if (rules.some((r) => /allow/i.test(r.action))) return { state: 'allowed', detail: `MX Bikes is allowed through Windows Firewall (${network} network)` };
  if (on.every((p) => /allow/i.test(p.inbound))) return { state: 'allowed', detail: 'Windows Firewall lets incoming connections in on this network' };
  return { state: 'blocked', detail: `Windows Firewall has no rule letting MX Bikes in on your ${network} network` };
}

async function check(exe) {
  if (process.platform !== 'win32' || !exe) return { state: 'unknown', detail: 'MX Bikes was not found' };
  try { return evaluate(await read(exe)); } catch { return { state: 'unknown', detail: 'Windows Firewall could not be read' }; }
}

// Lets MX Bikes in (UDP, every network type) and turns off its inbound block rules, in one elevated
// PowerShell (Windows asks the player). Resolves when that window has closed.
function allow(exe) {
  const inner = `$exe = ${psQuote(exe)}
Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and ([Environment]::ExpandEnvironmentVariables($_.Program) -ieq $exe) } | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Disable-NetFirewallRule
Get-NetFirewallRule -DisplayName ${psQuote(RULE_NAME)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName ${psQuote(RULE_NAME)} -Direction Inbound -Program $exe -Protocol UDP -Action Allow -Profile Any | Out-Null`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const outer = `$p = Start-Process -FilePath ${psQuote(PS)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'; exit $p.ExitCode`;
  return powershell(outer, 120000).then(() => true, (e) => { throw new Error(/canceled|cancelled|1223/i.test(String(e.message)) ? 'Windows did not get permission (the administrator prompt was closed).' : 'Could not change Windows Firewall.'); });
}

module.exports = { check, allow, evaluate, RULE_NAME };
