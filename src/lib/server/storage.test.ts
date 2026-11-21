import { expect, test } from "bun:test";
import { sniffUpload } from "@/lib/server/storage";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

test("application uploads are typed by their bytes, not their name", () => {
  expect(sniffUpload(bytes("%PDF-1.7\n"))?.ext).toBe("pdf");
  expect(sniffUpload(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF"))?.ext).toBe("jpg");
  expect(sniffUpload(bytes([0x89], "PNG\r\n\x1a\n", [0, 0]))?.ext).toBe("png");
  expect(sniffUpload(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0]))?.type).toBe("image/heic");
  expect(sniffUpload(bytes([0, 0, 0, 0x18], "ftypmif1"))?.ext).toBe("heic");
});

test("anything else is refused, whatever it claims to be", () => {
  expect(sniffUpload(bytes("<html><script>alert(1)</script>"))).toBeNull();
  expect(sniffUpload(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  expect(sniffUpload(bytes("GIF89a"))).toBeNull();
  expect(sniffUpload(bytes([0, 0, 0, 0x18], "ftypmp42"))).toBeNull(); // a video
  expect(sniffUpload(new Uint8Array())).toBeNull();
});
