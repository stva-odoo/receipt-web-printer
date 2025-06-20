const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
var cors = require("cors");
const path = require("path");
const { convertRasterFile } = require("./lib/epson");
const { generateIOTModule } = require("./lib/iot");

const os = require("os");
const fs = require("fs-extra");
const slugify = require("slugify");

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
    limit: "2mb",
  })
);
app.set("view engine", "ejs");

const serverIp = process.env.SERVER_IP || "127.0.0.1";

async function processReceipt(req, res) {
  const printerName = req.params.name;
  const filename = `r-${Date.now()}.jpg`;
  const destFilePath = path.join(receiptDir, filename);
  try {
    await convertRasterFile(req.body, destFilePath);
    res.send("<response success='true'></response>");
  } catch (err) {
    console.error("Error converting data:", err);
    return res.sendStatus(500);
  }
  io.to(printerName).emit("new-image", { filename: "/receipt/" + filename });
}

app.get("/printer/:name", async (req, res) => {
  const printerName = slugify(req.params.name);
  //TODO url for http, and https server name
  res.render("printer", {
    printerName: printerName,
    http_ip: serverIp + ":3000/" + printerName,
    https_ip: serverIp + ":3443/" + printerName,
  });
});

app.post("/:name/cgi-bin/epos/service.cgi", processReceipt);
app.post("/printer/:name/cgi-bin/epos/service.cgi", processReceipt);

async function processIOReceipt(req, res) {
  const printerName = req.headers.host.split(".")[0];
  const data = req.body?.params?.data;
  if (!data) {
    return res.status(400).send("Missing receipt data");
  }

  try {
    const parsedData = JSON.parse(data);
    //TODO check action
    if (!parsedData.receipt) {
      res.json({ result: true });
      return;
    }
    const base64Image = parsedData.receipt.replace(
      /^data:image\/\w+;base64,/,
      ""
    );
    const imageBuffer = Buffer.from(base64Image, "base64");
    const filename = `iot-${Date.now()}.jpg`;
    const destFilePath = path.join(receiptDir, filename);
    await fs.writeFile(destFilePath, imageBuffer);
    res.json({ result: true });
    io.to(printerName).emit("new-image", { filename: "/receipt/" + filename });
  } catch (err) {
    console.error("Error iot:", err);
    return res.sendStatus(500);
  }
}

app.post(
  "/hw_drivers/action",
  express.json({ limit: "1mb" }),
  processIOReceipt
);

app.get("/iot/:name", async (req, res) => {
  const printerName = req.params.name;
  await generateIOTModule(printerName + ".pos.stva.ovh", printerName, res);
});

// Middleware for authenticating sockets
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  socket.join(token);
  next();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Printer listening on port ${PORT}`);
});
