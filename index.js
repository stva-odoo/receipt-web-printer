const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const xmlFormat = require("xml-formatter");
var cors = require("cors");
const path = require("path");
const hljs = require("highlight.js/lib/core");
hljs.registerLanguage("xml", require("highlight.js/lib/languages/xml"));

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

app.use(
  express.text({
    type: ["application/xml", "text/xml", "application/vnd.wap.wml", "*/*"],
  })
);
app.set("view engine", "ejs");

const serverHostName = process.env.SERVER_HOST_NAME || "pos.stva.ovh";

async function processReceipt(req, res) {
  const printerName = req.params.name;

  try {
    const xml = req.body;
    if (xml.indexOf("<image") >= 0) {
      const filename = `r-${Date.now()}.jpg`;
      const destFilePath = path.join(receiptDir, filename);
      await convertRasterFile(req.body, destFilePath);
      io.to(printerName).emit("new-image", {
        filename: "/receipt/" + filename,
      });
    } else if (xml.indexOf("<pulse") >= 0) {
      io.to(printerName).emit("new-text", {
        text: "Cash drawer opened.",
      });
    } else if (xml.indexOf("<text") >= 0) {
      const xmlData = Buffer.isBuffer(xml) ? xml.toString("utf8") : xml;
      const textMatches = [
        ...xmlData.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi),
      ];
      const combinedText = textMatches
        .map((m) => m[1].replace(/&#10;/g, "\n").replace(/&#13;/g, "\r").trim())
        .join("\n");
      io.to(printerName).emit("new-text", {
        text: combinedText,
      });
    }

    res.send("<response success='true' code=''></response>");
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

app.get("/hw_proxy/hello", async (req, res) => {
  res.json({ result: true });
});

// IoT

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
  await generateIOTModule(printerName + "." + serverHostName, printerName, res);
});

// Italian fiscal printer

async function processItFiscalCommand(req, res) {
  const printerName = req.params.name;
  const xmlBody = req.body || "";

  //TODO handle more response
  const xmlResponse = `
  <response>
    <data >
      <result success="true" code="200" status="OK">
        <info>
          <responseData>xxx</responseData>
        </info>
      </result>
    </data>
  </response>
`;

  res.status(200).type("application/xml").send(xmlResponse);

  const formattedXML = xmlFormat(xmlBody);
  io.to(printerName).emit("new-xml", {
    data: hljs.highlight(formattedXML, { language: "xml" }).value,
    originalData: formattedXML,
    date: Date.now,
  });
}

app.post("/:name/cgi-bin/fpmate.cgi", processItFiscalCommand);
app.post("/printer/:name/cgi-bin/fpmate.cgi", processItFiscalCommand);

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
