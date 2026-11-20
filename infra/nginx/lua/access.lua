-- This runs for EVERY proxied route, not just an exact /api/auth location.
-- Encoded arguments, duplicate arguments and path aliases cannot bypass login checks.
ngx.req.clear_header("X-Calo-Login-Proxy")
if ngx.req.get_method() ~= "POST" then return end

local args, args_error = ngx.req.get_uri_args(20)
local function respond(status, message, retry)
    ngx.status = status
    ngx.header["Content-Type"] = "application/json; charset=utf-8"
    ngx.header["Cache-Control"] = "no-store"
    if retry then ngx.header["Retry-After"] = retry end
    ngx.say(message)
    return ngx.exit(status)
end
if args_error or (args.action ~= nil and type(args.action) ~= "string") then
    return respond(400, '{"error":"Tham số yêu cầu không hợp lệ."}')
end
if args.action ~= "login" then return end

local secret = os.getenv("LOGIN_PROXY_SECRET")
if not secret or #secret < 32 then
    return respond(503, '{"error":"Cổng đăng nhập chưa sẵn sàng."}', 1)
end
local locks = require "resty.lock"
local lock, lock_error = locks:new("login_locks", {timeout = 0.2, exptime = 1})
if not lock then return respond(503, '{"error":"Vui lòng thử lại sau."}', 1) end
-- remote_addr is the TCP peer by default. Never trust arbitrary X-Forwarded-For.
local key = ngx.var.binary_remote_addr
local elapsed, err = lock:lock(key)
if not elapsed then return respond(503, '{"error":"Vui lòng thử lại sau."}', 1) end
local allowed, retry, remaining, storage_error = require("login_window").check(ngx.shared.login_windows, key, ngx.now())
lock:unlock()
if storage_error then return respond(503, '{"error":"Vui lòng thử lại sau."}', 1) end
ngx.header["X-RateLimit-Limit"] = 5
ngx.header["X-RateLimit-Window"] = 1800
ngx.header["X-RateLimit-Remaining"] = remaining
if not allowed then
    return respond(429, '{"error":"Bạn đã dùng hết 5 lần đăng nhập trong 30 phút. Vui lòng thử lại sau."}', retry)
end
-- Only requests admitted by the quota receive this proof; never send it to browsers.
ngx.req.set_header("X-Calo-Login-Proxy", secret)
