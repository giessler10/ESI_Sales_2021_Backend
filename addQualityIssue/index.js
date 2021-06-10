//******* IMPORTS *******

const mysql = require('mysql2/promise');
var config = require('./config');
const axios = require('axios');


//******* GLOBALS *******

var res;
var message;
var response;
var body_production = [];
var body_production_Parsed;

var body_mawi;
var stored;

var new_QI_Counter;
var orderitem;
var order;

//******* DATABASE CONNECTION *******

const con = {
  host: config.host,
  user: config.user,
  password: config.password,
  port: config.port,
};

//******* EXPORTS HANDLER  *******

exports.handler = async (event, context, callback) => {
  const pool = await mysql.createPool(con);

  // get event data
  let O_NR = event.O_NR;  //Ordernummer
  let qualityIssueItems = event.body;

  //Fehler schmeißen wenn Body kein Array ist.
  if (!Array.isArray(qualityIssueItems)) {
    message = 'Fehlerhafte Daten im Body';
        
    response = {
      statusCode: 400,
      errorMessage: message,
      errorType: "Bad Request"
    };
    //Fehler schmeisen
    context.fail(JSON.stringify(response));
  }

  try{
    //Prüfen ob der Auftrag existiert
    await callDBResonse(pool, checkOrderExist(O_NR));
    if(res == null){
      message = 'Der Auftrag' + O_NR + ' wurde nicht gefunden.';
      
      response = {
        statusCode: 404,
        errorMessage: message,
        errorType: "Not Found"
      };
      
      //Fehler schmeisen
      context.fail(JSON.stringify(response));
    }
    else{
      //Status der Order ändern
      //await callDB(pool, updateOrderStatus(O_NR, 5)); //Wird über DB geändert
      
      //Quality Issues anlegen und den Status der Orderitems ändern
      for (var i = 0; i < qualityIssueItems.length; i++) {
        //Status prüfen
        await callDBResonse(pool, getMaxPO_COUNTER_AND_STATE(qualityIssueItems[i].QI_O_NR, qualityIssueItems[i].QI_OI_NR));
        if(res == null){
          new_QI_Counter = 1;

          //Quality Issue anlegen
          await callDB(pool, insertNewQualityIssue(qualityIssueItems[i].QI_O_NR, qualityIssueItems[i].QI_OI_NR, new_QI_Counter, 1, qualityIssueItems[i].QI_QTY, qualityIssueItems[i].QI_COMMENT));

          //Status Orderitem ändern
          await callDB(pool, updateOrderitemStatus(qualityIssueItems[i].QI_O_NR, qualityIssueItems[i].QI_OI_NR, 12));

          await callDBResonse(pool, getOrderOrderitem(O_NR, qualityIssueItems[i].QI_OI_NR));
          orderitem = res[0];

          //Prüfen, ob Orderitem in MaWi existiert
          body_mawi = buildRequestBodyOrderMaWi(O_NR, "Q", orderitem);
          await callDBResonse(pool, getOrderAvailability(body_mawi));

          if(stored){
            //Status QualityIssue aktualisieren
            await callDBResonse(pool, updateQualityIssueStatus(O_NR, qualityIssueItems[i].QI_OI_NR, qualityIssueItems[i].QI_COUNTER, 5));

          }
          //Neue Produktion auslösen
          else{
            order = buildNewOrderObject("Q", new_QI_Counter, orderitem);
            body_production.push(order);
          }
        }
        else if(res[0].QI_IST_NR == 8 || res[0].QI_IST_NR == 10){
          new_QI_Counter = res[0].QI_COUNTER + 1;

          //Quality Issue anlegen
          await callDB(pool, insertNewQualityIssue(qualityIssueItems[i].QI_O_NR, qualityIssueItems[i].QI_OI_NR, new_QI_Counter, 1, qualityIssueItems[i].QI_QTY, qualityIssueItems[i].QI_COMMENT));

          //Status Orderitem ändern
          await callDB(pool, updateOrderitemStatus(qualityIssueItems[i].QI_O_NR, qualityIssueItems[i].QI_OI_NR, 12));

          await callDBResonse(pool, getOrderOrderitem(O_NR, qualityIssueItems[i].QI_OI_NR));
          orderitem = res[0];

          //Prüfen, ob Orderitem in MaWi existiert
          body_mawi = buildRequestBodyOrderMaWi(O_NR, "Q", orderitem);
          await callDBResonse(pool, getOrderAvailability(body_mawi));

          if(stored){
            //Status QualityIssue aktualisieren
            await callDBResonse(pool, updateQualityIssueStatus(O_NR, qualityIssueItems[i].QI_OI_NR, qualityIssueItems[i].QI_COUNTER, 5));

          }
          //Neue Produktion auslösen
          else{
            order = buildNewOrderObject("Q", new_QI_Counter, orderitem);
            body_production.push(order);
          }
        }
      }
      
      body_production_Parsed = JSON.stringify(body_production);
          
      await postProductionOrder(body_production_Parsed);
      //console.log(body_production_Parsed);
 
      var messageJSON = {
        message: 'Die QS wurde erfasst.'
      };

      response = {
        statusCode: 200,
        message: JSON.stringify(messageJSON)
      }; 
      return response;
    }
    
  }
  catch (error) {
    console.log(error);
    
    response = {
      statusCode: 500,
      errorMessage: "Internal Server Error",
      errorType: "Internal Server Error"
    };
    
    //Fehler schmeisen
    context.fail(JSON.stringify(response));
  }
  finally {
      await pool.end();
  }
};

//******* DB Call Functions *******

async function callDB(client, queryMessage) {
    await client.query(queryMessage)
      .catch(console.log);
}

async function callDBResonse(client, queryMessage) {
  var queryResult = 0;
  await client.query(queryMessage)
    .then(
      (results) => {
        queryResult = results[0];
        return queryResult;
      })
    .then(
      (results) => {
        //Prüfen, ob queryResult == []
        if(!results.length){
          //Kein Eintrag in der DB gefunden
          res = null;
        }
        else{
          res = JSON.parse(JSON.stringify(results));
          return results;
        }
      })
    .catch();
}

//************ Hilfsfunktionen ************
const buildRequestBodyOrderMaWi = function (OI_O_NR, PO_CODE, orderitem) {
  var resonse = {
    body: [
      {
        "O_NR": OI_O_NR,
        "OI_NR": orderitem.OI_NR,
        "PO_CODE": PO_CODE,
        "PO_COUNTER": "1",
        "QUANTITY": orderitem.OI_QTY,
        "HEXCOLOR": orderitem.HEXCOLOR,
        "IMAGE": orderitem.IM_FILE
      }
    ]
  };
  
  console.log(resonse);
  return JSON.stringify(resonse);
};

const buildNewOrderObject = function (PO_CODE, PO_COUNTER, orderitem) {
  var customerType;

  if(orderitem.C_CT_ID == "B2C"){
    customerType = "P";
  }
  else{
    customerType = "B";
  }
  
  var order = {
      O_NR: orderitem.O_NR,
      OI_NR: orderitem.OI_NR,
      PO_CODE: PO_CODE,
      PO_COUNTER: PO_COUNTER,
      QUANTITY: orderitem.OI_QTY,
      CUSTOMER_TYPE: customerType,
      O_DATE: orderitem.O_TIMESTAMP,
      IMAGE: orderitem.IM_FILE,
      HEXCOLOR: orderitem.OI_HEXCOLOR
  };
  
  return order;
};

//Check if database is offline (AWS)
const IsDataBaseOffline = function (res){

  if(res.data.errorMessage == null) return false; 
  if(res.data.errorMessage === 'undefined') return false;
  if(res.data.errorMessage.endsWith("timed out after 3.00 seconds")){
      alert("Database is offline (AWS).");
      return true;
  }     
  return false;
};

//************ API Call Production ************

async function postProductionOrder(body) {
  let parsed;
  //console.log(body);
  
  await axios.post('https://1ygz8xt0rc.execute-api.eu-central-1.amazonaws.com/main/createorder', body)
    .then((results) => {

      parsed = JSON.stringify(results.data);
      //console.log(parsed);
      res = JSON.parse(parsed);
      res = res.body;
      //console.log(res);
      return results;
    })
    .catch((error) => {
      console.error(error);
    }); 
}

//************ API Call MaWi ************

async function getOrderAvailability(body) {
  let parsed;
  //console.log(body);
  
  await axios.get('https://9j8oo3h3yk.execute-api.eu-central-1.amazonaws.com/Main/gervorproduktionvv', body)
    .then((results) => {

      if(IsDataBaseOffline(results)){
        stored = false;
        return; //Check if db is available
      } 

      parsed = JSON.stringify(results.data);
      //console.log(parsed);
      res = JSON.parse(parsed);
      stored = res.stored;
      return results;
    })
    .catch((error) => {
      console.error(error);
    });
}

//******* SQL Statements *******

const updateOrderitemStatus = function (O_NR, OI_NR, IST_NR) {
  var queryMessage = "UPDATE ORDER.ORDERITEM SET OI_IST_NR = " + IST_NR + " WHERE OI_O_NR = " + O_NR + " AND OI_NR = " + OI_NR + ";";
  //console.log(queryMessage);
  return (queryMessage);
};

const checkOrderExist = function (O_NR) {
  var queryMessage = "SELECT * FROM ORDER.ORDER WHERE O_NR='" + O_NR + "';";
  //console.log(queryMessage);
  return (queryMessage);
};

const updateOrderStatus = function (O_NR, O_OST_NR) {
  var queryMessage = "UPDATE `ORDER`.`ORDER` SET `O_OST_NR` = '" + O_OST_NR + "' WHERE (`O_NR` = '" + O_NR + "');";
  //console.log(queryMessage);
  return (queryMessage);
};

const insertNewQualityIssue = function (QI_O_NR, QI_OI_NR, QI_COUNTER, QI_IST_NR, QI_QTY, QI_COMMENT) {
  var queryMessage = "INSERT INTO `QUALITY`.`QUALITYISSUE` (QI_O_NR, QI_OI_NR, QI_COUNTER, QI_IST_NR, QI_QTY, QI_COMMENT) VALUES ('" + QI_O_NR + "', '" + QI_OI_NR + "', '" + QI_COUNTER + "', '" + QI_IST_NR + "', '" + QI_QTY + "', '" + QI_COMMENT + "');";
  //console.log(queryMessage);
  return (queryMessage);
};

const getOrderOrderitem= function (O_NR, OI_NR) {
  var queryMessage = "SELECT O_NR, OI_NR, OI_QTY, C_CT_ID, O_TIMESTAMP, IM_FILE, OI_HEXCOLOR FROM VIEWS.FULLORDER WHERE O_NR = "+ O_NR + " AND OI_NR=" + OI_NR + ";";
  console.log(queryMessage);
  return (queryMessage);
};

const getMaxPO_COUNTER_AND_STATE= function (QI_O_NR, QI_OI_NR) {
  var queryMessage = "SELECT QI_COUNTER, QI_IST_NR FROM QUALITY.QUALITYISSUE WHERE QI_O_NR=" + QI_O_NR + " AND QI_OI_NR=" + QI_OI_NR + " AND QI_COUNTER=(Select max(QI_COUNTER) FROM QUALITY.QUALITYISSUE WHERE QI_O_NR=" + QI_O_NR + " AND QI_OI_NR=" + QI_OI_NR + ");";
  console.log(queryMessage);
  return (queryMessage);
};

const updateQualityIssueStatus = function (QI_O_NR, QI_OI_NR, QI_COUNTER, QI_IST_NR) {
  var queryMessage = "UPDATE `QUALITY`.`QUALITYISSUE` SET `QI_IST_NR` = '" + QI_IST_NR + "' WHERE (`QI_O_NR` = '"+ QI_O_NR + "') and (`QI_OI_NR` = '" + QI_OI_NR + "') and (`QI_COUNTER` = '" + QI_COUNTER + "');";
  //console.log(queryMessage);
  return (queryMessage);
};