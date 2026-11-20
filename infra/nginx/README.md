# Nginx: 5 lần đăng nhập / 30 phút / IP

Gateway dùng **OpenResty (Nginx + Lua)**, cửa sổ trượt 1800 giây. Năm yêu cầu đầu tiên được chuyển tiếp ngay; yêu cầu tiếp theo nhận JSON `429` và `Retry-After` là số giây tới lượt trống tiếp theo. Tính cả lần đăng nhập thành công, sai mật khẩu hoặc dữ liệu không hợp lệ. Yêu cầu bị chặn không làm tăng thời gian chờ.

Chỉ POST với query `action=login` bị tính quota. GET kiểm tra phiên, refresh, đăng xuất, đổi mật khẩu, Telegram/Zalo webhook và cron không dùng quota đăng nhập. Việc kiểm tra được đặt trước mọi route proxy, vì vậy đổi đường dẫn hoặc mã hoá query không mở một lối đăng nhập khác. Query trùng `action` hoặc vượt giới hạn parser bị từ chối.

`limit_req` thông thường chỉ nhận `r/s` và `r/m`, không diễn đạt trực tiếp 5 yêu cầu trong 30 phút. Lua giữ tối đa 5 timestamp/IP trong shared memory giữa các worker, có khoá per-IP cho cập nhật đồng thời và trả `503` nếu không thể lưu trạng thái.

## Kiến trúc triển khai

```text
Trình duyệt → HTTPS Nginx/OpenResty trên VPS → HTTPS ứng dụng Vercel → Supabase Auth
```

Vercel tiếp tục chạy ứng dụng, nhưng không chạy tiến trình Nginx. Cần một VPS/máy chủ Docker cho gateway. DNS của domain công khai trỏ vào VPS; upstream dùng hostname `your-project.vercel.app` không có redirect quay về gateway.

## Cấu hình

1. Tạo `LOGIN_PROXY_SECRET` ngẫu nhiên (ít nhất 32 ký tự chữ/số/`_`/`-`), ví dụ:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

2. Đặt secret này trong Vercel Production Environment Variables và redeploy. Đặt `APP_URL` ở Vercel thành origin **domain công khai của gateway**, ví dụ `https://calo.example.com`, để cookie và kiểm tra Origin hoạt động đúng.
3. Sao chép `gateway.env.example` thành `gateway.env`, điền cùng secret và `VERCEL_ORIGIN_HOST` (chỉ hostname, không thêm `https://` hoặc đường dẫn). Không đưa `gateway.env` vào git. Nếu dùng Vercel Deployment Protection, điền automation bypass secret trong `VERCEL_PROTECTION_BYPASS`; gateway chuyển secret bằng header, không bằng URL.
4. Cấp chứng chỉ TLS đúng domain, đặt `tls/fullchain.pem`, `tls/privkey.pem` trên VPS. Thư mục TLS không được đưa vào git. Gateway chỉ mount đọc; việc cấp/gia hạn chứng chỉ do người vận hành quản lý. Nếu dùng symlink từ Certbot, bảo đảm đích symlink cũng có trong mount hoặc dùng bản sao an toàn được cập nhật khi gia hạn.
5. Tại thư mục `infra/nginx` trên VPS:

   ```sh
   docker compose --env-file gateway.env build
   docker compose --env-file gateway.env run --rm gateway openresty -t
   docker compose --env-file gateway.env up -d
   ```

6. Trỏ DNS domain công khai vào VPS, mở cổng 80/443 và truy cập domain qua HTTPS. HTTP chuyển sang HTTPS. API login production từ chối yêu cầu không có bằng chứng gateway; gọi domain Vercel trực tiếp không vượt được hạn mức. Nếu chưa đặt secret ở production, login trả `503` thay vì âm thầm bỏ giới hạn. Khi rollout, chuẩn bị gateway/certificate trước, cập nhật Vercel và DNS trong cùng đợt để tránh gián đoạn đăng nhập.

Browser không gửi hoặc biết `LOGIN_PROXY_SECRET`. Lua xoá header giả do client gửi và chỉ thêm header hợp lệ sau khi quota được chấp nhận. Trên máy local, có thể để **không khai báo** `LOGIN_PROXY_SECRET` để chạy dev trực tiếp; nếu đã khai báo thì vẫn phải đi qua gateway.

## Địa chỉ IP và phạm vi bộ đếm

Mặc định dùng IP kết nối TCP (`binary_remote_addr`), không tin `X-Forwarded-For` do client tự đặt. Nếu đứng sau Cloudflare/load balancer, thêm `set_real_ip_from` **chỉ cho CIDR của proxy tin cậy** cùng `real_ip_header` phù hợp; không dùng `0.0.0.0/0`. Nếu chưa cấu hình, mọi người dùng qua một proxy có thể dùng chung quota. Người dùng chung NAT cũng dùng chung 5 lượt.

Bộ đếm dùng chung giữa worker của **một instance** OpenResty. Chạy nhiều gateway độc lập cần backend quota chung (chẳng hạn Redis), nếu không mỗi instance có 5 lượt riêng. Graceful reload cùng shared zone giữ bộ đếm; restart container/tiến trình hoàn toàn xoá bộ đếm. Không áp dụng quota này cho toàn bộ Supabase Auth bên ngoài endpoint đăng nhập của ứng dụng.

## Xác nhận sau triển khai

Từ cùng IP, gửi sáu POST tới `https://calo.example.com/api/auth?action=login` với Origin đúng. Có thể dùng body `{}` để tránh tạo phiên thật: năm lần đầu nhận `400` từ kiểm tra dữ liệu của ứng dụng, lần thứ sáu phải là `429` từ gateway có `Retry-After`. Thử thêm `action=%6cogin`, đường dẫn `/api/auth/` và header X-Forwarded-For giả; chúng không được mở thêm quota. Truy cập trực tiếp origin Vercel với Origin hợp lệ nhưng không có proof phải nhận `403`.

Chạy `npm.cmd test` ở repo để kiểm tra mã Lua thực tế bằng Fengari và kiểm tra API guard. Tests dùng đồng hồ giả để xác nhận mốc hết hạn, lượt được trả lại dần, IP độc lập, bộ nhớ đầy, header giả và query trùng. Môi trường phát triển hiện tại không có Docker/Nginx, nên cấu hình container, TLS và luồng proxy thật cần được xác nhận bằng `openresty -t` và smoke test trên VPS.

Tài liệu: [Nginx rate limits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html), [OpenResty Docker](https://github.com/openresty/docker-openresty), [lua-resty-lock](https://github.com/openresty/lua-resty-lock), [Vercel bypass header](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).
