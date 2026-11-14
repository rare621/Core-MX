@echo off
rem Opens TCP port 60000 in Windows Firewall for the MX Bikes Manager online service.
rem Right-click this file and choose "Run as administrator".
netsh advfirewall firewall delete rule name="MXBM online service" >/dev/null 2>&1
netsh advfirewall firewall add rule name="MXBM online service" dir=in action=allow protocol=TCP localport=60000
if errorlevel 1 (echo.& echo Failed - right-click this file and choose "Run as administrator".) else (echo.& echo Port 60000 is open in Windows Firewall. Forward TCP 60000 on your router to this PC too.)
pause
