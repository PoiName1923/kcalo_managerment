-- Called while holding the per-IP resty.lock. Never evict another IP's quota.
local M = {}
local WINDOW, LIMIT = 1800, 5

function M.check(dict, key, now)
    local active = {}
    local stored = dict:get(key)
    if stored then
        for item in string.gmatch(stored, "[^,]+") do
            local timestamp = tonumber(item)
            if not timestamp then return false, 1, 0, "invalid limiter state" end
            if timestamp > now - WINDOW then active[#active + 1] = timestamp end
        end
    end
    if #active >= LIMIT then
        return false, math.max(1, math.ceil(active[1] + WINDOW - now)), 0
    end
    active[#active + 1] = now
    local encoded = {}
    for i, timestamp in ipairs(active) do encoded[i] = tostring(timestamp) end
    local ok, err = dict:safe_set(key, table.concat(encoded, ","), WINDOW)
    if not ok then return false, 1, 0, err end
    return true, 0, LIMIT - #active
end

return M
