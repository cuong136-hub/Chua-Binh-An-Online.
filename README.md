# NGUYỄN NGỌC CƯỜNG — CHÙA BÌNH AN ONLINE

Một game chùa 2D chơi ngay trên trình duyệt, giao diện tiếng Việt, có **tượng Phật, khói hương bay**, hồ sen, cây hoa, sân chùa và nhân vật chibi.

## Các chức năng đã làm

- Tạo **phòng riêng** với ID 6 ký tự (ví dụ `A3B5CD`).
- Bạn bè mở cùng trang web, **nhập mã ID** hoặc bấm **link mời** để vào cùng phòng.
- Hiện người chơi trong phòng theo thời gian thực (SSE), tối đa **16 người/phòng**.
- Điều khiển nhân vật bằng **W A S D / phím mũi tên**; trên điện thoại có phím điều hướng cảm ứng.
- **Thắp hương, cầu bình an, thỉnh chuông**. Mọi người cùng thấy hiệu ứng và bộ đếm.
- **Chat tiếng Việt** ngay trong phòng; chọn màu trang phục; âm thanh chuông tổng hợp có thể bật/tắt.
- Không cần đăng ký tài khoản, không cần cơ sở dữ liệu và không có thư viện Node.js ngoài.

## Chạy game trên máy Windows

1. Cài **Node.js 18 trở lên** tại https://nodejs.org/ nếu chưa có.
2. Giải nén ZIP, giữ nguyên các file và thư mục.
3. Nháy đúp `start_game.bat` (hoặc mở Terminal trong thư mục và gõ `node server.js`).
4. Mở `http://localhost:3000` trên Chrome, Edge hoặc trình duyệt hiện đại.
5. Điền tên, chọn màu và bấm **Tạo phòng của riêng mình**.
6. Ở máy khác, nếu truy cập được **cùng máy chủ**, bạn bè nhập ID phòng của bạn để vào.

**Chú ý:** `localhost:3000` chỉ truy cập trên chính máy tính chạy máy chủ. Bạn bè ở nơi khác **không** thể truy cập được bằng địa chỉ `localhost` của bạn. Hãy triển khai game lên Internet theo hướng dẫn tiếp theo.

## Đưa game lên Internet để bất kỳ ai có link đều vào được

Cách đơn giản cho người mới: **GitHub + Render Web Service**.

1. Trên [GitHub](https://github.com/), tạo repository mới, ví dụ `Nguyen-Ngoc-Cuong-Chua-Online`.
2. Chọn **Add file → Upload files**, tải **toàn bộ nội dung đã giải nén** lên. Quan trọng: `server.js`, `package.json` và thư mục `public` phải nằm ở gốc repository (không lồng thêm một thư mục khác). Commit các file.
3. Vào https://dashboard.render.com/ và đăng nhập, chọn **New → Web Service** (không phải Static Site).
4. Kết nối GitHub, chọn repository vừa tạo.
5. Thiết lập:
   - Language / Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type / Plan: **Free** nếu tùy chọn này đang có sẵn.
6. Chọn **Create Web Service** và đợi nền tảng triển khai. Khi hoàn thành, Render cung cấp link dạng `https://ten-ban-chon.onrender.com`.
7. **Bạn và bạn bè đều mở chung link Render đó.** Bạn tạo phòng và gửi ID 6 ký tự hoặc nút **Sao chép link mời**. Người kia chọn **Vào phòng**.

Có thể tham khảo hướng dẫn chính thức: https://render.com/docs/web-services và https://render.com/docs/free

**Không dùng GitHub Pages đơn thuần:** Game này cần `server.js` chạy để đồng bộ người chơi. GitHub Pages chỉ chứa file tĩnh nên không tạo được phòng nhiều người chơi thực sự.

## Lưu ý về phòng và dữ liệu

- Phiên bản này lưu phòng **trong bộ nhớ máy chủ**, không lưu vào cơ sở dữ liệu. Khi máy chủ tắt, khởi động lại hoặc nền tảng ngủ đông, phòng cũ và lịch sử chat có thể mất. Hãy tạo ID mới.
- Trên gói Free, Render có thể tạm dừng máy chủ sau thời gian không hoạt động và mất một lúc để khởi động lại.
- ID phòng hoạt động **chỉ trong cùng một máy chủ**. Bạn mở `localhost` còn người kia mở bản Render thì không thể cùng phòng.
- Game thích hợp để giải trí, trình diễn hoặc làm đồ án nhỏ; chưa có hệ thống tài khoản, kiểm duyệt chat, lưu trữ lâu dài hay quản trị nâng cao.
- Hiện tại sử dụng tài nguyên do mã nguồn tự vẽ, không phụ thuộc ảnh/tệp âm thanh bên ngoài.

## Cấu trúc dự án

```text
Nguyen_Ngoc_Cuong_Chua_Online/
├── server.js              # Máy chủ HTTP + phòng + đồng bộ SSE
├── package.json           # Lệnh npm start
├── start_game.bat          # Mở nhanh trên Windows
├── README.md               # Hướng dẫn
└── public/
    ├── index.html          # Giao diện tiếng Việt
    ├── style.css           # Thiết kế và responsive
    └── game.js             # Thế giới chùa, hoạt ảnh và tương tác
```

## Kiểm tra hoạt động

- Gọi `GET /api/health` để xác nhận máy chủ đang chạy.
- Dùng hai cửa sổ trình duyệt riêng: một cửa sổ tạo phòng; cửa sổ còn lại nhập ID để vào. Cả hai sẽ xuất hiện ở sân chùa.
- Thử chat, di chuyển và thắp hương để kiểm tra đồng bộ.

© 2026 — Dự án game cá nhân mang tên **Nguyễn Ngọc Cường**.
