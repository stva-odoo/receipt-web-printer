const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
var cors = require("cors");
const path = require("path");
const { convertRasterFile } = require("./lib/epson");
const os = require("os");
const fs = require("fs-extra");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const receiptDir = path.join(os.tmpdir(), "pos_receipt/");
fs.emptyDirSync(receiptDir);

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use("/receipt", express.static(receiptDir));
app.use(
  express.raw({
    type: ["image/*", "text/plain"],
    limit: "50mb",
  })
);

app.post("/cgi-bin/epos/service.cgi", async (req, res) => {
  const filename = `r-${Date.now()}.jpg`;
  const destFilePath = path.join(receiptDir, filename);
  try {
    await convertRasterFile(req.body, destFilePath);
    res.send("<response success='true'></response>");
  } catch (err) {
    console.error("Error converting data:", err);
    return res.sendStatus(500);
  }
  io.emit("newImage", { filename: "receipt/" + filename });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Printer listening on port ${PORT}`);
});
