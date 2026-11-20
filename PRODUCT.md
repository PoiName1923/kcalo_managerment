# Calo Ingest

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Người dùng nhận ước tính dinh dưỡng từ ảnh qua Telegram và xem thống kê trên web. Quản trị viên quản lý tài khoản. Việc cấp tài khoản bởi quản trị viên là mặc định đề xuất, đang chờ lựa chọn khác nếu có.

## Product Purpose

Thống kê lượng dinh dưỡng đã ghi nhận, quản lý bot Telegram và Gemini API riêng theo tài khoản.

## Operating Context

Backend TypeScript trên Vercel, Supabase Postgres/Storage, Telegram và Gemini. Giao diện tiếng Việt, dùng trên máy tính và điện thoại.

Hỗ trợ thêm Zalo Bot API chính thức làm kênh nhận ảnh/phản hồi, chọn theo từng cấu hình. Các bot hiện có mặc định là Telegram; người dùng có thể dùng hai kênh song song bằng các cấu hình riêng.

## Capabilities and Constraints

Đăng nhập Supabase Auth; tách dữ liệu giữa tài khoản. Khoá API không trả về trình duyệt. Ảnh xoá sau 30 ngày; dữ liệu chi tiết archive JSON.gz; số liệu tổng hợp tiếp tục phục vụ thống kê. Thông tin dinh dưỡng là ước tính từ ảnh.

## Evidence on Hand

Backend và kiểm thử có sẵn. Chưa có credentials hoặc dữ liệu production. Giao diện không được trình bày dữ liệu mẫu như dữ liệu thật.
