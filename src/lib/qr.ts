import { randomInt } from "crypto";

// Без похожих символов (0/O, 1/I) — код вводится вручную на кассе
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generatePickupCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
