
  /**
   * Leadscrapper Pixnom — Google Apps Script Backend (UPDATED WITH AUTOMATION)
   * Sheet ID: 11Oy76Kfd4kdVLOuUBjUeUXusEPLCHUM4ipbi6APmA3U
   */

  // ─── SET YOUR URL HERE (Use Ngrok for Localhost testing) ───
  var MILESWEB_AUTOMATION_URL = "https://map2web.pixnom.com/automation.php";
  var WHATSAPP_API_URL = "https://your-whatsapp-api-url-here";

  var LEAD_COLS = [
    'Title','Price','CategoryName','Address','Neighborhood','Street',
    'City','PostalCode','State','CountryCode','Phone','PhoneUnformatted',
    'ClaimThisBusiness','Cid','Location','TotalScore','ReviewsCount',
    'ImagesCount','ImageCategories','PeopleAlsoSearch','PlacesTags',
    'ReviewsTags','GasPrices','GoogleFoodUrl','HotelAds','OpeningHours',
    'Url','SearchPageUrl','SearchString','Language','Rank','IsAdvertisement',
    'ImageUrl','Kgmid','Website','AdditionalInfo','ReviewsDistribution',
    'AdditionalOpeningHours','Description','LocatedIn',
    'PlaceId','ExtractedEmail','LeadScore','Status','Notes','Issues',
    'CreatedAt','FollowUpDate','UserEmail', 'Interested', 'Tier1', 'Tier2', 'Tier3', 'Tier1_short', 'Tier2_short', 'Tier3_short'
  ];

  var USER_EMAIL_COL_INDEX = LEAD_COLS.indexOf('UserEmail');
  var PLACE_ID_COL_INDEX = LEAD_COLS.indexOf('PlaceId');

  var EMAIL_COLS = ['EmailId','LeadId','LeadName','FromEmail','ToEmail','Subject','Body','SentAt','Status','UserEmail'];
  var REPORT_COLS = ['ReportId','LeadId','LeadName','CreatedAt','Score','UserEmail'];

  // =====================================================================
  // YOURLS URL SHORTENER
  // =====================================================================
  function shortenUrl(longUrl) {
    if (!longUrl || longUrl.toString().indexOf("http") !== 0) return longUrl;
    try {
      var resp = UrlFetchApp.fetch("https://pixnom.com/demo/yourls-api.php", {
        method: "post",
        payload: {
          signature: "205c371093",
          action: "shorturl",
          format: "json",
          url: longUrl
        },
        muteHttpExceptions: true
      });
      var json = JSON.parse(resp.getContentText());
      return json.shorturl || (json.url && json.url.shorturl) || longUrl;
    } catch(e) {
      return longUrl;
    }
  }

  // =====================================================================
  // 🚀 THE TRIGGER: WATCHES FOR 'Interested' = 'Yes' (MULTI-ROW SAFE)
  // =====================================================================
  function installableOnEdit(e) {
    if (!e || !e.range) return;

    var sheet = e.range.getSheet();
    var sName = sheet.getName();
    if (sName !== "Sheet1" && sName !== "India-WhatsApp" && sName !== "IndiaLeads") return;

    var colMap = getColMap(sheet);
    if (colMap['Interested'] === undefined) return;

    var interestedColSheet = colMap['Interested'] + 1;
    var editStartCol = e.range.getColumn();
    var editEndCol = editStartCol + e.range.getNumColumns() - 1;

    if (interestedColSheet < editStartCol || interestedColSheet > editEndCol) return;

    var startRow = e.range.getRow();
    var numRows = e.range.getNumRows();

    var MAX_INSTANT = 5;

    if (numRows <= MAX_INSTANT) {
      for (var r = 0; r < numRows; r++) {
        var rowNum = startRow + r;
        var cellValue = sheet.getRange(rowNum, interestedColSheet).getValue();
        if (cellValue === "Yes") {
          var tier1Val = (colMap['Tier1'] !== undefined) ? sheet.getRange(rowNum, colMap['Tier1'] + 1).getValue() : "";
          if (tier1Val && tier1Val.toString().indexOf("http") === 0) continue;
          processSingleRow(sheet, colMap, rowNum);
        }
      }
    }
  }

  // =====================================================================
  // PROCESS A SINGLE ROW — used by both onEdit and batch processor
  // =====================================================================
function processSingleRow(sheet, colMap, rowNum) {                                                                             
    var dataRow = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];                                                var rowData = {};                                                                                                            
                                                                                                                                 
    for (var key in colMap) {
      rowData[key] = dataRow[colMap[key]];
    }

    if (colMap['Tier1'] !== undefined) {
      sheet.getRange(rowNum, colMap['Tier1'] + 1).setValue("Processing...");
    }

    var options = {
      'method' : 'post',
      'contentType': 'application/json',
      'payload' : JSON.stringify(rowData),
      'muteHttpExceptions': true
    };

    try {
      var response = UrlFetchApp.fetch(MILESWEB_AUTOMATION_URL, options);
      var responseText = response.getContentText();
      var responseCode = response.getResponseCode();

      // Guard against non-JSON responses (HTML error pages, server errors)
      if (responseCode < 200 || responseCode >= 300) {
        if (colMap['Tier1'] !== undefined) sheet.getRange(rowNum, colMap['Tier1'] + 1).setValue("Error: Server returned HTTP " + 
  responseCode);
        return;
      }

      var result;
      try {
        result = JSON.parse(responseText);
      } catch(parseErr) {
        var snippet = responseText.substring(0, 120);
        if (colMap['Tier1'] !== undefined) sheet.getRange(rowNum, colMap['Tier1'] + 1).setValue("Error: Invalid JSON - " +       
  snippet);
        return;
      }

      if (result.success && result.github_response) {
          var tier1Raw = result.github_response.tier1 || "";
          var tier2Raw = result.github_response.tier2 || "";
          var tier3Raw = result.github_response.tier3 || "";

          // Raw GitHub links in Tier1/Tier2/Tier3
          if (colMap['Tier1'] !== undefined) sheet.getRange(rowNum, colMap['Tier1'] + 1).setValue(tier1Raw);
          if (colMap['Tier2'] !== undefined) sheet.getRange(rowNum, colMap['Tier2'] + 1).setValue(tier2Raw);
          if (colMap['Tier3'] !== undefined) sheet.getRange(rowNum, colMap['Tier3'] + 1).setValue(tier3Raw);

          // Shortened links in Tier1_short/Tier2_short/Tier3_short (backup)
          var tier1Short = shortenUrl(tier1Raw);
          var tier2Short = shortenUrl(tier2Raw);
          var tier3Short = shortenUrl(tier3Raw);

          if (colMap['Tier1_short'] !== undefined) sheet.getRange(rowNum, colMap['Tier1_short'] + 1).setValue(tier1Short);
          if (colMap['Tier2_short'] !== undefined) sheet.getRange(rowNum, colMap['Tier2_short'] + 1).setValue(tier2Short);
          if (colMap['Tier3_short'] !== undefined) sheet.getRange(rowNum, colMap['Tier3_short'] + 1).setValue(tier3Short);

          sendWhatsAppMessage(rowData['Title'], rowData['Phone'], tier1Short, tier2Short, tier3Short);
      } else {
          if (colMap['Tier1'] !== undefined) sheet.getRange(rowNum, colMap['Tier1'] + 1).setValue("Error: " + (result.message || 
  "Unknown"));
      }
    } catch(err) {
       if (colMap['Tier1'] !== undefined) sheet.getRange(rowNum, colMap['Tier1'] + 1).setValue("Failed: " + err.message);        
    }
  }

  // =====================================================================
  // BATCH PROCESSOR — Picks up pending rows (Interested=Yes, Tier1 empty)
  // =====================================================================
  var BATCH_SIZE = 10;

  function processPendingRows() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = ['Sheet1', 'India-WhatsApp', 'IndiaLeads'];

    for (var t = 0; t < tabs.length; t++) {
      var sheet = ss.getSheetByName(tabs[t]);
      if (!sheet) continue;

      var colMap = getColMap(sheet);
      if (colMap['Interested'] === undefined || colMap['Tier1'] === undefined) continue;

      var data = sheet.getDataRange().getValues();
      var intIdx = colMap['Interested'];
      var tier1Idx = colMap['Tier1'];
      var processed = 0;

      for (var i = 1; i < data.length; i++) {
        if (processed >= BATCH_SIZE) break;

        var interested = (data[i][intIdx] || '').toString().trim();
        var tier1Val = (data[i][tier1Idx] || '').toString().trim();

        if (interested === "Yes" && tier1Val === "") {
          var rowNum = i + 1;
          processSingleRow(sheet, colMap, rowNum);
          processed++;
        }
      }
    }
  }

  // =====================================================================
  // ONE-TIME SETUP: Run this once to create the 1-minute batch trigger
  // =====================================================================
  function setupBatchTrigger() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'processPendingRows') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    ScriptApp.newTrigger('processPendingRows')
      .timeBased()
      .everyMinutes(1)
      .create();
  }

  function sendWhatsAppMessage(bizName, phone, tier1Link, tier2Link, tier3Link) {
      if (!phone) return;
      var msg = "Hello " + bizName + ", we've designed 3 premium website concepts for you! Check them out: \n" +
                "Tier 1: " + tier1Link + "\nTier 2: " + tier2Link + "\nTier 3: " + tier3Link + "\n\nLet us know if you're interested!";

      var payload = { phone: phone, message: msg };
      var options = { 'method' : 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload) };
      try { UrlFetchApp.fetch(WHATSAPP_API_URL, options); } catch(e) {}
  }

  // =====================================================================
  // EXISTING APP SCRIPT FUNCTIONS
  // =====================================================================

  function getLeadsSheet() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0];
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var lastCol = headers.length;
    var appCols = ['PlaceId','ExtractedEmail','LeadScore','Status','Notes','Issues','CreatedAt','FollowUpDate','UserEmail', 'Interested', 'Tier1', 'Tier2',
  'Tier3', 'Tier1_short', 'Tier2_short', 'Tier3_short'];
    for (var i = 0; i < appCols.length; i++) {
      if (headers.indexOf(appCols[i]) === -1) {
        lastCol++;
        sheet.getRange(1, lastCol).setValue(appCols[i]).setFontWeight('bold');
      }
    }
    return sheet;
  }

  function getOrCreateSheet(name, headers) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  function getColMap(sheet) {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var map = {};
    for (var i = 0; i < headers.length; i++) {
      map[headers[i]] = i;
    }
    return map;
  }

  function doGet(e) {
    var action = e.parameter.action || 'load';
    var email = (e.parameter.email || '').toLowerCase();
    var callback = e.parameter.callback;

    if (!email) {
      return respond({success: false, error: 'Missing email'}, callback);
    }

    if (action === 'load') {
      var leads = getLeadsForUser(email);
      var sentEmails = getRowsForUser('SentEmails', EMAIL_COLS, email);
      var reports = getRowsForUser('Reports', REPORT_COLS, email);
      return respond({success: true, leads: leads, emails: sentEmails, reports: reports}, callback);
    }

    var dataStr = e.parameter.data || '{}';
    var data;
    try { data = JSON.parse(dataStr); } catch(err) {
      return respond({success: false, error: 'Invalid JSON'}, callback);
    }

    var userEmail = email;

    if (action === 'saveLead')      return respond(jsonResult(saveLead(userEmail, data.lead)), callback);
    if (action === 'bulkSaveLeads') return respond(jsonResult(bulkSaveLeads(userEmail, data.leads)), callback);
    if (action === 'updateLead')    return respond(jsonResult(updateLead(userEmail, data.PlaceId, data.fields)), callback);
    if (action === 'deleteLead')    return respond(jsonResult(deleteLead(userEmail, data.PlaceId)), callback);
    if (action === 'saveEmail')     return respond(jsonResult(saveEmailRow(userEmail, data.emailData)), callback);
    if (action === 'saveReport')    return respond(jsonResult(saveReport(userEmail, data.report)), callback);

    return respond({success: false, error: 'Unknown action: ' + action}, callback);
  }

  function jsonResult(contentOutput) {
    try { return JSON.parse(contentOutput.getContent()); }
    catch(e) { return {success: false, error: 'Parse error'}; }
  }

  function getLeadsForUser(userEmail) {
    var sheet = getLeadsSheet();
    var colMap = getColMap(sheet);
    var data = sheet.getDataRange().getValues();
    var emailIdx = colMap['UserEmail'];
    var results = [];

    if (emailIdx === undefined) return results;

    for (var i = 1; i < data.length; i++) {
      var rowEmail = (data[i][emailIdx] || '').toString().toLowerCase();
      if (rowEmail === userEmail) {
        var obj = {};
        for (var key in colMap) {
          obj[key] = data[i][colMap[key]] !== undefined ? data[i][colMap[key]] : '';
        }
        results.push(obj);
      }
    }
    return results;
  }

  function getRowsForUser(sheetName, headers, userEmail) {
    var sheet = getOrCreateSheet(sheetName, headers);
    var data = sheet.getDataRange().getValues();
    var emailIdx = headers.indexOf('UserEmail');
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var rowEmail = (data[i][emailIdx] || '').toString().toLowerCase();
      if (rowEmail === userEmail) {
        var obj = {};
        for (var j = 0; j < headers.length; j++) {
          obj[headers[j]] = data[i][j] !== undefined ? data[i][j] : '';
        }
        results.push(obj);
      }
    }
    return results;
  }

  function doPost(e) {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || '';
    var email = (data.UserEmail || '').toLowerCase();

    if (!email) {
      return jsonOut({success: false, error: 'Missing UserEmail'});
    }

    if (action === 'saveLead')      return saveLead(email, data.lead);
    if (action === 'bulkSaveLeads') return bulkSaveLeads(email, data.leads);
    if (action === 'updateLead')    return updateLead(email, data.PlaceId, data.fields);
    if (action === 'deleteLead')    return deleteLead(email, data.PlaceId);
    if (action === 'saveEmail')     return saveEmailRow(email, data.emailData);
    if (action === 'saveReport')    return saveReport(email, data.report);

    return jsonOut({success: false, error: 'Unknown action: ' + action});
  }

  function saveLead(userEmail, lead) {
    var sheet = getLeadsSheet();
    var colMap = getColMap(sheet);
    var placeId = lead.PlaceId || '';

    if (placeId && colMap['PlaceId'] !== undefined && colMap['UserEmail'] !== undefined) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if ((data[i][colMap['UserEmail']] || '').toString().toLowerCase() === userEmail &&
            (data[i][colMap['PlaceId']] || '').toString() === placeId) {
          return jsonOut({success: true, message: 'Lead already exists'});
        }
      }
    }

    var totalCols = sheet.getLastColumn();
    var row = [];
    for (var c = 0; c < totalCols; c++) row.push('');
    if (colMap['UserEmail'] !== undefined) row[colMap['UserEmail']] = userEmail;

    for (var key in lead) {
      if (colMap[key] !== undefined) {
        var val = lead[key];
        if (val === undefined || val === null) val = '';
        if (typeof val === 'object') val = JSON.stringify(val);
        if (typeof val === 'boolean') val = val.toString();
        row[colMap[key]] = val;
      }
    }

    sheet.appendRow(row);
    return jsonOut({success: true, message: 'Lead saved'});
  }

  function bulkSaveLeads(userEmail, leads) {
    var sheet = getLeadsSheet();
    var colMap = getColMap(sheet);
    var data = sheet.getDataRange().getValues();
    var totalCols = sheet.getLastColumn();

    var existing = {};
    if (colMap['PlaceId'] !== undefined && colMap['UserEmail'] !== undefined) {
      for (var i = 1; i < data.length; i++) {
        if ((data[i][colMap['UserEmail']] || '').toString().toLowerCase() === userEmail) {
          existing[(data[i][colMap['PlaceId']] || '').toString()] = true;
        }
      }
    }

    var newRows = [];
    for (var j = 0; j < leads.length; j++) {
      var pid = leads[j].PlaceId || '';
      if (!existing[pid]) {
        var row = [];
        for (var c = 0; c < totalCols; c++) row.push('');
        if (colMap['UserEmail'] !== undefined) row[colMap['UserEmail']] = userEmail;
        for (var key in leads[j]) {
          if (colMap[key] !== undefined) {
            var val = leads[j][key];
            if (val === undefined || val === null) val = '';
            if (typeof val === 'object') val = JSON.stringify(val);
            if (typeof val === 'boolean') val = val.toString();
            row[colMap[key]] = val;
          }
        }
        newRows.push(row);
      }
    }

    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, totalCols).setValues(newRows);
    }
    return jsonOut({success: true, message: newRows.length + ' leads saved'});
  }

  function updateLead(userEmail, placeId, fields) {
    var sheet = getLeadsSheet();
    var colMap = getColMap(sheet);
    var data = sheet.getDataRange().getValues();

    if (colMap['PlaceId'] === undefined || colMap['UserEmail'] === undefined) {
      return jsonOut({success: false, message: 'Missing columns'});
    }

    for (var i = 1; i < data.length; i++) {
      if ((data[i][colMap['UserEmail']] || '').toString().toLowerCase() === userEmail &&
          (data[i][colMap['PlaceId']] || '').toString() === placeId) {
        for (var key in fields) {
          if (colMap[key] !== undefined) {
            var val = fields[key];
            if (Array.isArray(val)) val = JSON.stringify(val);
            sheet.getRange(i + 1, colMap[key] + 1).setValue(val);
          }
        }
        return jsonOut({success: true, message: 'Lead updated'});
      }
    }
    return jsonOut({success: false, message: 'Lead not found'});
  }

  function deleteLead(userEmail, placeId) {
    var sheet = getLeadsSheet();
    var colMap = getColMap(sheet);
    var data = sheet.getDataRange().getValues();

    if (colMap['PlaceId'] === undefined || colMap['UserEmail'] === undefined) {
      return jsonOut({success: false, message: 'Missing columns'});
    }

    for (var i = data.length - 1; i >= 1; i--) {
      if ((data[i][colMap['UserEmail']] || '').toString().toLowerCase() === userEmail &&
          (data[i][colMap['PlaceId']] || '').toString() === placeId) {
        sheet.deleteRow(i + 1);
        return jsonOut({success: true, message: 'Lead deleted'});
      }
    }
    return jsonOut({success: false, message: 'Lead not found'});
  }

  function saveEmailRow(userEmail, emailData) {
    var sheet = getOrCreateSheet('SentEmails', EMAIL_COLS);
    var row = buildRow(userEmail, emailData, EMAIL_COLS);
    sheet.appendRow(row);
    return jsonOut({success: true, message: 'Email saved'});
  }

  function saveReport(userEmail, report) {
    var sheet = getOrCreateSheet('Reports', REPORT_COLS);
    var row = buildRow(userEmail, report, REPORT_COLS);
    sheet.appendRow(row);
    return jsonOut({success: true, message: 'Report saved'});
  }

  function buildRow(userEmail, obj, headers) {
    var row = [];
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] === 'UserEmail') {
        row.push(userEmail);
      } else {
        var val = obj[headers[i]];
        if (val === undefined || val === null) val = '';
        if (typeof val === 'object') val = JSON.stringify(val);
        if (typeof val === 'boolean') val = val.toString();
        row.push(val);
      }
    }
    return row;
  }

  function jsonOut(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }

  function respond(obj, callback) {
    var json = JSON.stringify(obj);
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

