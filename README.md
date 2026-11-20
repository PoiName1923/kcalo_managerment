# Calo Ingest

Bot Telegram nhận ảnh món ăn, dùng Gemini ước tính dinh dưỡng và lưu lịch sử bằng Supabase. Backend TypeScript chạy trên Vercel, không cần máy chủ chạy liên tục.

## Giới hạn đăng nhập bằng Supabase

Ứng dụng chạy trực tiếp trên Vercel và giới hạn **5 yêu cầu đăng nhập / 30 phút / IP** bằng một cửa sổ trượt atomic trong Supabase. Lần vượt mức nhận `429` và `Retry-After`; đăng nhập sai hoặc dữ liệu không hợp lệ vẫn dùng một lượt. Chỉ khóa HMAC của IP được lưu, không lưu IP thô. Các yêu cầu refresh, bot và cron không dùng quota này.

Chạy migration `004_login_rate_limit.sql` và đặt `LOGIN_RATE_LIMIT_SECRET` giống nhau ở mọi Vercel Function của cùng môi trường. Có thể cấu hình thêm Vercel Firewall/WAF làm lớp bảo vệ bên ngoài, nhưng ứng dụng không phụ thuộc vào lớp này để thực thi giới hạn.

## Web console: đăng nhập, thống kê và quản lý cấu hình

### Chọn Telegram hoặc Zalo Bot

Chạy migration `003_zalo_channel.sql` **sau 001 và 002**, rồi chạy `004_login_rate_limit.sql` trước khi deploy mã nguồn. Các migration không xoá bữa ăn hay cấu hình bot cũ.

Trong **Bot & API → Thêm bot**, chọn **Kênh nhận ảnh: Telegram / Zalo Bot**. Mỗi kênh có Bot Token, User ID người gửi và Gemini key riêng; có thể thêm hai cấu hình để dùng song song. Kênh của cấu hình đã lưu không đổi được tại chỗ, để tránh chuyển nhầm lịch sử và webhook sang nền tảng khác.

Đối với **Zalo Bot** (không phải Zalo OA hoặc tự động hoá tài khoản cá nhân):

1. Tạo bot qua Zalo Bot Manager / Zalo Bot Creator theo [tài liệu chính thức](https://docs.zaloplatforms.com/docs/BOT), lấy Bot Token.
2. Nhập đúng Zalo User ID của tài khoản gửi ảnh. Đây là chuỗi ID trong `message.from.id`; không dùng số điện thoại/username, không ép chuỗi này thành Number. Có thể lấy ID từ công cụ thử bot của bạn theo cơ chế polling trong giai đoạn thiết lập, rồi dừng polling trước khi đăng ký webhook. Ứng dụng không tự mở đăng ký người gửi để dò ID.
3. Lưu, kiểm tra API và bấm **Kết nối Zalo Bot**. Server đăng ký `/api/webhook?bot=<uuid>` và xác thực bằng header `X-Bot-Api-Secret-Token`. Nếu Zalo báo webhook không truy cập được, bot không được đánh dấu hoạt động; kiểm tra domain production/Deployment Protection rồi kết nối lại.
4. Gửi `/start`, ảnh món ăn và chú thích. Các lệnh `/today`, `/history`, `/archive <id>` dùng chung luồng xử lý, thống kê và chính sách lưu trữ với Telegram.

Zalo gửi ảnh qua `message.photo_url` và timestamp mili giây. Server chỉ nhận sự kiện ảnh/văn bản trong chat riêng từ ID đã cấu hình, loại webhook lặp theo `(bot_id, message_id)`, tải ảnh HTTPS công khai có giới hạn 10 MiB và chặn IP nội bộ/DNS rebinding. Downloader hiện dùng IPv4, kiểm tra lại từng redirect; URL ảnh cần còn hạn tới lúc worker xử lý.

Phản hồi Zalo được chia đoạn tối đa 2000 UTF-16 code unit. Với `/archive`, Telegram gửi file trực tiếp; Zalo nhận liên kết private Storage có hạn **5 phút**, sau kiểm tra quyền sở hữu và checksum. Không giả định có API `sendDocument` cho Zalo Bot. Không chia sẻ liên kết này nếu muốn giữ archive riêng tư.

Không cần thêm biến môi trường Zalo chung: token từng bot vẫn được mã hoá bằng `CREDENTIAL_ENCRYPTION_KEY`. Gemini, nén ảnh, xoá ảnh sau 30 ngày và archive không đổi. Tài khoản Zalo thực tế/model quota/webhook production cần được kiểm tra bằng credentials của chủ tài khoản.

Tham chiếu: [webhook nhận ảnh](https://docs.zaloplatforms.com/docs/BOT/webhook), [getMe](https://docs.zaloplatforms.com/docs/BOT/apis/getMe), [setWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook), [sendMessage](https://docs.zaloplatforms.com/docs/BOT/apis/sendMessage).

Ứng dụng có các trang `/login`, `/dashboard`, `/integrations`, `/users` (quản trị viên) và `/account`. Dashboard hiển thị kcal, số bữa, protein/carb/chất béo, biểu đồ 7/30/90 ngày, lọc theo bot, tổng từ đầu và số lượt gọi/token Gemini. Token API không được quy đổi thành chi phí tiền khi chưa có cấu hình giá. Các số liệu tổng hợp theo ngày vẫn giữ khi chi tiết bữa ăn chuyển sang archive.

**Nâng cấp database:** chạy lần lượt các migration còn thiếu theo số thứ tự, hiện tại là `002_web_console.sql`, `003_zalo_channel.sql`, rồi `004_login_rate_limit.sql`. Không chạy lại migration đã áp dụng trên database hiện có. Dữ liệu bot chung cũ vẫn hoạt động nếu giữ biến môi trường legacy; dữ liệu đó không tự động gán cho một tài khoản web bất kỳ.

**Đăng nhập:** bật Supabase Auth Email/Password. Mặc định quản trị viên cấp tài khoản; tắt public signups trong Supabase Auth. Profile mới cũng bị chặn mặc định cho tới khi được cấp quyền, kể cả khi public signup vô tình bật. Tạo tài khoản quản trị đầu tiên bằng Supabase Dashboard → Authentication → Users → Add user (email đã xác nhận), rồi chạy lệnh dưới với đúng email:

```sql
update public.profiles
set role = 'admin', active = true
where email = 'YOUR-ADMIN-EMAIL';
```

Sau đó đăng nhập và tạo tài khoản thành viên tại trang Người dùng. Người dùng đổi mật khẩu ở Tài khoản. Quản trị viên có thể tạm khoá/kích hoạt; mỗi API và webhook kiểm tra trạng thái tài khoản. Việc cấp quyền admin chỉ thực hiện bằng SQL của người vận hành. Nếu quên mật khẩu, người vận hành đặt lại trong Supabase Dashboard.

**Biến môi trường bổ sung:** `SUPABASE_ANON_KEY` (anon/publishable key cho Auth), `APP_URL` (origin chính xác, ví dụ `https://calo.example.com`) và `CREDENTIAL_ENCRYPTION_KEY` (32 byte ngẫu nhiên, mã hoá base64). Tạo khoá mã hoá một lần:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Lưu khoá này trong Vercel Environment Variables và một nơi backup riêng. Không đổi hoặc xoá khoá khi còn cấu hình đã mã hoá; muốn xoay khoá cần giải mã bằng khoá cũ rồi mã hoá lại. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY` giờ chỉ dành cho bot chung legacy; có thể để trống khi dùng bot riêng.

**Thêm bot:** vào Bot & API, nhập Telegram token, Telegram User ID được phép gửi ảnh, Gemini API key và model. Lưu, kiểm tra API, rồi bấm Kết nối Telegram để thay webhook của bot bằng webhook ứng dụng. Token/key dùng AES-256-GCM trên server, không trả về trình duyệt; để trống trường bí mật khi sửa để giữ giá trị cũ. Mỗi bot được gắn với một Telegram bot ID duy nhất và chủ tài khoản. Admin không có API đọc token/key của người khác. Phiên web dùng cookie HttpOnly/Secure và kiểm tra cùng origin cho các thao tác ghi.

Giữ lịch Supabase worker và Vercel maintenance như bên dưới. Worker xử lý cả hàng đợi bot riêng và bot chung nếu được cấu hình. Endpoint `/api/health` vẫn dành cho kiểm tra tiến trình; trang gốc `/` giờ mở giao diện.

**Chạy tại máy:**

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run dev
```

Mở `http://127.0.0.1:4173`. Để đăng nhập thật tại máy, đặt `APP_URL=http://127.0.0.1:4173` trong `.env`; kết nối Telegram cần URL HTTPS production. Preview cục bộ chỉ mở các API giao diện, không dùng để nhận webhook Telegram.

```powershell
npm.cmd test
npm.cmd run test:ui
```

Kiểm thử UI dùng Edge đã cài (`channel: msedge`) ở desktop/mobile và API fixture, không chạm dữ liệu thật. Ảnh kiểm thử trong `.impeccable/review` là dữ liệu giả lập được kiểm soát, không phải số liệu của tài khoản thật. Máy không có Edge có thể cài Edge hoặc đổi Playwright sang Chromium và cài browser tương ứng.

## Chức năng

- Nhận ảnh gửi dưới dạng **Photo** trong chat riêng; mỗi ảnh trong album là một lần phân tích.
- Trả tên món, khối lượng (g), kcal và khoảng kcal, protein/carb/chất béo, mức chắc chắn và giả định.
- `/today`: cộng dinh dưỡng theo ngày Việt Nam; `/history`: 5 bữa và 5 archive gần nhất; `/archive <id>`: tải JSON.gz của chính người dùng.
- Postgres giữ chi tiết 30 ngày. Archive JSON.gz được upload, tải lại và đối chiếu SHA-256 trước khi transaction xoá chi tiết. Database chỉ giữ manifest nhỏ để tìm archive.
- Ảnh lưu: WebP cạnh dài tối đa 640px, quality 30, effort 6, bỏ metadata. Ảnh JPEG phân tích tối đa 1600px chỉ nằm trong bộ nhớ và được gửi tới Gemini.
- Tác vụ hằng ngày xoá bản ảnh lưu quá 30 ngày, độc lập với archive. Bucket riêng tư; ảnh gốc không được lưu vào Supabase.

## Triển khai

### 1. Chuẩn bị dịch vụ

Tạo bot bằng [@BotFather](https://t.me/BotFather), lấy Telegram bot token. Tạo Gemini API key trong [Google AI Studio](https://aistudio.google.com/). Tạo một project [Supabase](https://supabase.com/dashboard).

Trong Supabase SQL Editor chạy các file trong `supabase/migrations` **một lần theo thứ tự 001 → 004**. Các migration tạo bảng, RPC, index, RLS và hai private bucket `meal-images`, `meal-archives`. Backend dùng service role key (Settings → API); không đưa key này vào client hoặc git.

### 2. Cấu hình biến môi trường

Sao chép `.env.example` thành `.env` và điền giá trị. Tạo hai secret độc lập bằng lệnh sau, chạy hai lần:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| Biến | Nội dung |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret ngẫu nhiên ít nhất 32 ký tự, chữ/số/`_`/`-` |
| `GEMINI_API_KEY` | API key Gemini |
| `GEMINI_MODEL` | Model hỗ trợ ảnh + JSON schema, mặc định mẫu `gemini-3.5-flash-lite`; xác nhận model khả dụng trong tài khoản |
| `SUPABASE_URL` | URL HTTPS project |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key chỉ dùng phía server |
| `CRON_SECRET` | Secret ngẫu nhiên ít nhất 32 ký tự; Vercel Cron dùng biến này để xác thực |
| `ALLOWED_TELEGRAM_USER_IDS` | Tuỳ chọn: ID người dùng cách nhau bằng dấu phẩy; để trống cho phép mọi chat riêng |
| `APP_URL` | Origin production trên Vercel, dùng cho web Auth/CSRF và đăng ký webhook |
| `LOGIN_RATE_LIMIT_SECRET` | Secret URL-safe ít nhất 32 ký tự, dùng HMAC IP trước khi ghi bộ đếm đăng nhập vào Supabase |

### 3. Deploy lên Vercel

Đưa thư mục dự án lên Git repository của bạn và Import Project trong Vercel. Nếu repository chứa nhiều dự án, đặt **Root Directory** là `calo_ingest`. Chọn Framework Preset **Other**, Node.js **24.x**; cấu hình build và functions nằm trong `vercel.json`.

Thêm các biến môi trường ở trên và biến bổ sung của Web console vào **Production** rồi deploy. Endpoint `/api/health` trả tình trạng tiến trình; nó không kiểm tra API key hoặc kết nối database.

Telegram và Supabase Cron phải gọi được URL production. Nếu bật Vercel Deployment Protection, cấu hình ngoại lệ/bypass phù hợp trước khi đăng ký webhook. Không dùng domain preview cho bot production.

### 4. Đăng ký Telegram webhook cho bot chung legacy

Nếu dùng bot riêng theo người dùng, bỏ qua bước này và dùng nút Kết nối Telegram trên web. Với bot chung legacy, điền `APP_URL` và các biến `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY`, sau đó chạy tại thư mục dự án:

```powershell
npm.cmd ci
npm.cmd run setup:telegram
```

Script đăng ký command menu và webhook với `secret_token`; không xoá các update đang chờ. Gửi `/start`, sau đó gửi ảnh với chú thích, ví dụ “150 g cơm, 1 trứng, ít dầu”.

### 5. Bật worker phục hồi

Trong Supabase SQL Editor chạy [schedule.sql](supabase/schedule.sql) sau khi thay domain và secret bằng giá trị thật. Script lưu secret trong Vault và gọi `/api/worker` mỗi phút để xử lý lại job bị gián đoạn. **Bước này cần thiết để hàng đợi tự phục hồi.**

Khi đổi secret/domain, cập nhật cả Vercel và Vault. Không tạo nhiều Vault secret trùng tên; dùng `vault.update_secret` theo chú thích trong script.

Vercel Cron gọi `/api/maintenance` hằng ngày lúc `20:00 UTC` (khoảng **03:00 hôm sau, giờ Việt Nam**; giờ chạy thực tế tuỳ gói Vercel). Mốc hết hạn là **30 × 24 giờ**, thực thi ở lần cron tiếp theo; không phải xoá đúng từng giây. Mỗi lần xử lý tối đa 500 ảnh và 20 archive × 100 bữa; dữ liệu tồn đọng sẽ tiếp tục ở lần chạy sau. Với lưu lượng lớn, tăng tần suất maintenance theo gói Vercel.

## Độ bền dữ liệu và giới hạn

Webhook chỉ trả thành công sau khi job được ghi vào Postgres. `update_id` là khoá chống trùng. Worker nhận lease 4 phút, thử xử lý tối đa 3 lần; kết quả đã lưu được dùng lại nếu chỉ lỗi gửi Telegram. Nếu hết lượt thử, thông báo lỗi được lưu trong hàng đợi, kể cả khi lần cuối bị ngắt đột ngột. Lỗi gửi thông báo được thử lại mỗi giờ cho tới khi gửi được hoặc record hết hạn 30 ngày. Payload job được xoá khi hoàn tất; record vận hành cũ được dọn sau 30 ngày. Ảnh được ghi vào ledger trước upload để dọn được cả ảnh của tác vụ lỗi.

Archive theo từng chat, tối đa 100 bữa mỗi file. Khi upload/verify/finalize lỗi, dữ liệu nguồn vẫn còn và tác vụ sau tiếp tục cùng batch. Ảnh hết hạn được xoá qua Storage API, không xoá trực tiếp bảng `storage.objects`. Archive JSON giữ đường dẫn ảnh như thông tin lịch sử; ảnh tương ứng sẽ hết hạn. Archive giữ vô thời hạn theo yêu cầu hiện tại. Archive cùng project Storage giúp giảm dữ liệu trong Postgres; đây không phải bản backup độc lập ngoài Supabase. Nên bật chính sách backup phù hợp cho project.

Bot chỉ xử lý ảnh Photo, không xử lý file Document, video hoặc tổng hợp nhiều góc chụp thành một bữa. Ảnh lưu có dung lượng thay đổi theo nội dung; cấu hình ưu tiên nhỏ nhưng vẫn nhận diện được. Việc xoá ảnh ở Supabase không xoá ảnh đã gửi trong Telegram hoặc dữ liệu do nhà cung cấp Gemini quản lý. Mô hình ước tính khẩu phần/dầu/sốt từ ảnh nên kết quả không tương đương việc cân thực phẩm.

Telegram `sendMessage` không hỗ trợ idempotency key: nếu Telegram nhận được tin nhưng kết nối mất trước lúc backend nhận phản hồi, lần thử lại có thể gửi trùng câu trả lời. Bữa ăn vẫn chỉ được ghi một lần.

## Kiểm thử và vận hành

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit
```

Tests chạy xử lý ảnh thật bằng Sharp, migration/RPC bằng Postgres WASM (PGlite), kiểm tra schema Gemini, archive gzip/checksum và quyền truy cập. Không gọi Gemini/Telegram/Supabase thật, không cần credentials. `build` kiểm tra TypeScript và chuẩn bị font tự lưu cho giao diện; Vercel biên dịch các function khi deploy.

Sau deploy, kiểm tra ảnh mẫu thực tế, `/today`, `/history`, `getWebhookInfo`, các job trong `jobs`, lịch Cron trong Supabase và log `/api/maintenance` của Vercel. Thử một bữa giả có tuổi hơn 30 ngày trong project test để xác nhận ảnh đã bị xoá và archive tải/giải nén được. Không chỉnh thời gian dữ liệu production để thử retention.

Log chỉ chứa tên sự kiện, update ID và số lần thử; không ghi ảnh, token, chú thích hay kết quả dinh dưỡng. Khi lỗi, kiểm tra quota Gemini, quyền Storage/RPC, lịch Supabase và môi trường Production.

Tài liệu nền tảng: [Telegram Bot API](https://core.telegram.org/bots/api), [Gemini ảnh](https://ai.google.dev/gemini-api/docs/image-understanding), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Supabase xoá object](https://supabase.com/docs/guides/storage/management/delete-objects), [Supabase Cron](https://supabase.com/docs/guides/cron), [Vercel waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil).
