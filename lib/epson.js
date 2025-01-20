const { createCanvas } = require("canvas");
const fs = require("fs-extra");

async function convertRasterFile(buffer, outputPath) {
  const fileContent = buffer.toString("utf8");
  const base64Match = fileContent.match(/<image\s+[^>]*>([^<]*)<\/image>/);
  const widthMatch = fileContent.match(/width="(\d+)"/);
  const heightMatch = fileContent.match(/height="(\d+)"/);
  if (!base64Match || !widthMatch || !heightMatch) {
    throw new Error(
      "Could not find valid raster image data or dimensions in the file."
    );
  }

  const base64Data = base64Match[1];
  const width = parseInt(widthMatch[1], 10);
  const height = parseInt(heightMatch[1], 10);
  await decodeAndGenerateImage(base64Data, width, height, outputPath);
}

async function decodeAndGenerateImage(base64Data, width, height, outputPath) {
  const binaryData = atob(base64Data);
  const rasterData = [];
  for (let i = 0; i < binaryData.length; i++) {
    const byte = binaryData.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) {
      const pixel = (byte >> (7 - bit)) & 1; // Extract individual bits
      rasterData.push(pixel);
    }
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const color = rasterData[index] === 1 ? 0 : 255; // 1 = black, 0 = white
      const pixelIndex = index * 4;

      imageData.data[pixelIndex] = color; // Red
      imageData.data[pixelIndex + 1] = color; // Green
      imageData.data[pixelIndex + 2] = color; // Blue
      imageData.data[pixelIndex + 3] = 255; // Alpha (fully opaque)
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const buffer = canvas.toBuffer("image/jpeg");
  await fs.writeFile(outputPath, buffer);
}

module.exports = {
  convertRasterFile,
};
