const archiver = require("archiver");

const MODULE_NAME = "fake_iot_printer";

const MANIFEST = `
{
    'name': 'Fake IoT Thermal Printer',
    'version': '1.0',
    'category': 'Tools',
    'summary': 'Creates a fake IoT Box and Thermal Printer device',
    'depends': ['iot'],
    'data': [
        'data.xml',
    ],
    'installable': True,
    'application': False,
}
`;

const DATA = (serverIp, printerName) => `
<odoo>
  <record id="fake_iot_box" model="iot.box">
      <field name="name">Fake IoT Box</field>
      <field name="identifier">00:00:00:00:00:00</field>
      <field name="ip">${serverIp}</field>
      <field name="version">19.12</field>
  </record>

  <record id="iot_printer" model="iot.device">
      <field name="name">Printer ${printerName}</field>
      <field name="iot_id" ref="fake_iot_box" />
      <field name="identifier">printer_identifier</field>
      <field name="type">printer</field>
      <field name="subtype">receipt_printer</field>
      <field name="manufacturer"></field>
      <field name="connection">network</field>
  </record>
</odoo>
`;

async function generateIOTModule(serverIp, printerName, res) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="fake_iot_printer' + printerName + '_module.zip"'
  );

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  archive.append(MANIFEST, { name: `${MODULE_NAME}/__manifest__.py` });
  archive.append(DATA(serverIp, printerName), {
    name: `${MODULE_NAME}/data.xml`,
  });

  await archive.finalize();
}

module.exports = {
  generateIOTModule,
};
