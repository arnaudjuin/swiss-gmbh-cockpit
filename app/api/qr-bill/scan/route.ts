import { NextRequest } from "next/server";
import jsQR from "jsqr";
import { Jimp } from "jimp";
import { guard, json, err } from "@/server/http";

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file || !file.name) return err(400, "No file uploaded");
  const raw = Buffer.from(await file.arrayBuffer());

  let img;
  try {
    img = await Jimp.read(raw);
  } catch (e) {
    return err(400, `Cannot read image: ${e instanceof Error ? e.message : e}`);
  }
  const { data, width, height } = img.bitmap;
  const decoded = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height);
  if (!decoded) return err(404, "No QR code found in image");

  const qrText = decoded.data;
  if (!qrText.startsWith("SPC")) return json({ raw: qrText, is_swiss_qr_bill: false });

  const lines = qrText.split("\n");
  const line = (i: number) => (i < lines.length ? lines[i].trim() : "");
  return json({
    is_swiss_qr_bill: true,
    version: line(1),
    iban: line(3),
    creditor: {
      name: line(5), address_line_1: line(6), address_line_2: line(7),
      postal_code: line(8), city: line(9), country: line(10),
    },
    amount: line(18) ? Number(line(18)) : null,
    currency: line(19),
    debtor: {
      name: line(21), address_line_1: line(22), address_line_2: line(23),
      postal_code: line(24), city: line(25), country: line(26),
    },
    reference_type: line(27),
    reference: line(28),
    additional_info: line(29),
  });
});
