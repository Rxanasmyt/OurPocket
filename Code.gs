function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'sync') {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) return ContentService.createTextOutput(JSON.stringify({status: "error"})).setMimeType(ContentService.MimeType.JSON);

    var sheet = spreadsheet.getActiveSheet();
    var values = sheet.getDataRange().getValues();
    var jsonArray = [];

    for(var i = 1; i < values.length; i++) {
        var lastColData = values[i][values[i].length - 1];
        if(lastColData && typeof lastColData === 'string' && lastColData.indexOf('{') === 0) {
            try { jsonArray.push(JSON.parse(lastColData)); } catch(err) {}
        }
    }
    return ContentService.createTextOutput(JSON.stringify({status: "success", data: jsonArray})).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput("✅ Our Wallet: Web App is running successfully!").setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    if (!e || !e.postData) return ContentService.createTextOutput(JSON.stringify({"status": "error"})).setMimeType(ContentService.MimeType.JSON);

    var data = JSON.parse(e.postData.contents);
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) return ContentService.createTextOutput(JSON.stringify({"status": "error"})).setMimeType(ContentService.MimeType.JSON);

    var sheet = spreadsheet.getActiveSheet();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];

    // สร้างหัวตารางถ้ายังไม่มี
    if (sheet.getLastRow() === 0 || headers.length < 5) {
      headers = ["ประเภท", "วันที่", "เดือน-ปี", "หมวดหมู่", "รายการ", "คนทำรายการ", "ธนาคาร", "งวดที่", "รวมงวด", "จำนวนเงิน", "สถานะ", "บันทึกเมื่อ", "ID", "RAW_JSON"];
      sheet.appendRow(headers);
      sheet.getRange("A1:N1").setFontWeight("bold").setBackground("#d9ead3");
    }

    var idColIdx = headers.indexOf("ID");
    if (idColIdx === -1) idColIdx = 11; // Fallback

    if (data.action === 'delete' && data.id) {
      var values = sheet.getDataRange().getValues();
      for (var i = 1; i < values.length; i++) {
        if (values[i][idColIdx] == data.id) {
          sheet.deleteRow(i + 1);
          return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "deleted"})).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({"status": "error"})).setMimeType(ContentService.MimeType.JSON);
    }

    var type = data.type === 'income' ? 'รายรับ' : 'รายจ่าย';
    var amount = data.type === 'income' ? data.netAmount : data.amount;
    var status = data.type === 'income' ? '-' : (data.isCompleted ? 'เสร็จสิ้น' : 'รอดำเนินการ');
    var dateStr = Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

    var rowData = [
      type || '-', data.date || '-', data.monthYear || '-', data.category || '-', data.description || '-',
      data.who || '-', data.bank || '-', data.currentInstallment || '-', data.totalInstallments || '-',
      amount || 0, status, dateStr, data.id || '-', JSON.stringify(data)
    ];

    var values = sheet.getDataRange().getValues();
    var rowIndex = -1;
    for(var i = 1; i < values.length; i++) {
       if(values[i][idColIdx] == data.id) { rowIndex = i + 1; break; }
    }

    // เติมข้อมูลให้ครบตามจำนวน Column ของ Header
    var finalRowData = [];
    for(var c = 0; c < headers.length; c++) {
      if(c < rowData.length) finalRowData.push(rowData[c]);
      else finalRowData.push(""); // เติมว่างถ้ามีคอลัมน์เกิน
    }
    finalRowData[headers.indexOf("RAW_JSON")] = JSON.stringify(data);

    if (rowIndex > -1) {
       sheet.getRange(rowIndex, 1, 1, finalRowData.length).setValues([finalRowData]);
    } else {
       sheet.appendRow(finalRowData);
    }

    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}
