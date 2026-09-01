#!/usr/bin/lua
-- blockcheckw prints "Scanning N/M" only when stdout is a TTY.
local posix = require("posix")
local unistd = require("posix.unistd")
local syswait = require("posix.sys.wait")

if not arg[1] or arg[1] == "" then
	io.stderr:write("pty-run.lua: missing command\n")
	os.exit(127)
end

local master, slave = posix.openpty()
if not master then
	io.stderr:write("pty-run.lua: openpty failed\n")
	os.exit(127)
end

local cmd = arg[1]
local argv = {}
for i = 2, #arg do
	argv[#argv + 1] = arg[i]
end

local pid = unistd.fork()
if pid == 0 then
	unistd.close(master)
	unistd.dup2(slave, 0)
	unistd.dup2(slave, 1)
	unistd.dup2(slave, 2)
	if slave > 2 then
		unistd.close(slave)
	end
	unistd.execp(cmd, argv)
	os.exit(127)
end

if type(slave) == "number" and slave >= 0 then
	unistd.close(slave)
end

if posix.signal and posix.SIGTERM then
	pcall(posix.signal, posix.SIGTERM, function()
		pcall(posix.kill, pid, posix.SIGTERM)
	end)
end
if posix.signal and posix.SIGINT then
	pcall(posix.signal, posix.SIGINT, function()
		pcall(posix.kill, pid, posix.SIGINT)
	end)
end

while true do
	local data = unistd.read(master, 4096)
	if not data or data == "" then
		break
	end
	io.stdout:write(data)
	io.stdout:flush()
end

local _w, why, status = syswait.wait(pid)
if why == "exited" then
	os.exit(status or 0)
end
if why == "killed" then
	os.exit(128 + (status or 0))
end
os.exit(1)
