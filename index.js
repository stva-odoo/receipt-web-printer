const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
var cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");
const { convertRasterFile } = require("./lib/epson");
const { generateIOTModule } = require("./lib/iot");
const { randomUUID } = require("crypto");

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

const serverHostName = process.env.SERVER_HOST_NAME || "pos.stva.ovh";
const db = new Database("configs.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT UNIQUE NOT NULL,
    config_json TEXT NOT NULL
  );
`);

async function processReceipt(req, res) {
  const printerName = req.params.name;
  const filename = `r-${randomUUID()}.jpg`;
  const destFilePath = path.join(receiptDir, filename);
  try {
    await convertRasterFile(req.body, destFilePath);
    sendImage(res, printerName, filename);
  } catch (err) {
    console.error("Error converting data:", err);
    return res.sendStatus(500);
  }
}

app.get("/printer/:name", async (req, res) => {
  const originalPrinterName = req.params.name;
  const printerName = slugify(originalPrinterName, {
    lower: true, // Required for iot module
    remove: /[*+~.()'"!:@]/g,
  });
  //TODO url for http, and https server name
  res.render("printer", {
    originalPrinterName,
    printerName: printerName,
    iotUrl: "/iot/" + printerName,
    http_ip: serverHostName + "/" + printerName,
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
    const parsedData = typeof data === "string" ? JSON.parse(data) : data;
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
    const filename = `iot-${randomUUID()}.jpg`;
    const destFilePath = path.join(receiptDir, filename);
    await fs.writeFile(destFilePath, imageBuffer);
    res.json({ result: true }); //TODO config error code  ...
    io.to(printerName).emit("new-image", { filename: "/receipt/" + filename });
  } catch (err) {
    console.error("Error iot:", err);
    return res.sendStatus(500);
  }
}

function getPrinterConfig(printerName) {
  let printerConfig = null;

  const select = db.prepare(
    "SELECT config_json FROM configs WHERE config_key = ?"
  );

  const row = select.get(printerName);
  if (row) {
    printerConfig = JSON.parse(row.config_json);
  }
  return printerConfig;
}

function sendImage(res, printerName, filename) {
  const printerConfig = getPrinterConfig(printerName);

  let attributes = "";

  // See: https://download4.epson.biz/sec_pubs/pos/reference_en/epos_print/ref_epos_print_xml_en_xmlforcontrollingprinter_response.html
  if (printerConfig && printerConfig.enabled) {
    const success = printerConfig.success ? true : false;
    attributes += `success='${success}'`;

    if (printerConfig.code) {
      attributes += ` code='${printerConfig.code}'`;
    }
    if (printerConfig.status) {
      attributes += ` status='${printerConfig.status}'`;
    }
    if (printerConfig.battery) {
      attributes += ` battery='${printerConfig.battery}'`;
    }
  } else {
    attributes = `success='true'`;
  }

  res.send(`<response ${attributes}></response>`);

  io.to(printerName).emit("new-image", {
    filename: `/receipt/${filename}`,
    config: printerConfig,
  });
}

app.post(
  "/hw_drivers/action",
  express.json({ limit: "1mb" }),
  processIOReceipt
);

app.get("/iot/:name", async (req, res) => {
  const printerName = req.params.name;
  await generateIOTModule(printerName + "." + serverHostName, printerName, res);
});

app.get("/hw_proxy/hello", async (req, res) => {
  res.json({ result: true });
});

app.post("/config/:name", express.json({}), async (req, res) => {
  const printerName = req.params.name;
  const data = req.body;

  if (!data) {
    const del = db.prepare("DELETE FROM configs WHERE config_key = ?");
    del.run(printerName);
  } else {
    const insert = db.prepare(
      "INSERT OR REPLACE INTO configs (config_key, config_json) VALUES (?, ?)"
    );
    insert.run(printerName, JSON.stringify(data));
  }
  return res.json({ config: data });
});

app.get("/config/:name", async (req, res) => {
  const printerName = req.params.name;
  const config = getPrinterConfig(printerName);
  return res.json({ config });
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
