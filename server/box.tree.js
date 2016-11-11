/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Forge Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

'use strict'; // http://www.w3schools.com/js/js_strict.asp

// token handling in session
var token = require('./token');

// web framework
var express = require('express');
var router = express.Router();

// config information, such as client ID and secret
var config = require('./config');

// box sdk: https://github.com/box/box-node-sdk/
var BoxSDK = require('box-node-sdk');

router.get('/box/authenticate', function (req, res) {
  var url =
    'https://account.box.com/api/oauth2/authorize?response_type=code&' +
    '&client_id=' + config.box.credentials.client_id +
    '&redirect_uri=' + config.box.callbackURL +
    '&state=autodeskforge';
  res.end(url);
});

// wait for box callback (oAuth callback)
router.get('/api/box/callback/oauth', function (req, res) {
  var code = req.query.code;
  var tokenSession = new token(req.session);

  var sdk = new BoxSDK({
    clientID: config.box.credentials.client_id, // required
    clientSecret: config.box.credentials.client_secret // required
  });

  sdk.getTokensAuthorizationCodeGrant(code, null, function (err, tokenInfo) {
    tokenSession.setBoxToken(tokenInfo.accessToken)
    console.log('Box token: ' + tokenSession.getBoxToken()); // debug
    res.redirect('/');
  });
});

// return the public token of the current user
// the public token should have a limited scope (read-only)
router.get('/box/isAuthorized', function (req, res) {
  var tokenSession = new token(req.session);
  res.end(tokenSession.isBoxAuthorized() ? 'true' : 'false');
});

router.get('/box/getTreeNode', function (req, res) {
  var tokenSession = new token(req.session);
  if (!tokenSession.isBoxAuthorized()) {
    res.status(401).end('Please box login first');
    return;
  }

  var sdk = new BoxSDK({
    clientID: config.box.credentials.client_id, // required
    clientSecret: config.box.credentials.client_secret // required
  });

  var box = sdk.getBasicClient(tokenSession.getBoxToken());

  var id = (req.query.id === '#' ? '0' : req.query.id);
  box.folders.getItems(id, {fields: 'name,shared_link,permissions,collections,sync_state'}, function (err, data) {
    res.end(prepareArrayForJSTree(data.entries));
  });
});

// Formats a list to JSTree structure
function prepareArrayForJSTree(listOf) {
  if (listOf == null) return '';
  var treeList = [];
  listOf.forEach(function (item, index) {
    //console.log(item);
    var treeItem = {
      id: item.id,
      text: item.name,
      type: item.type,
      children: (item.type === 'folder')
    };
    treeList.push(treeItem);
  });
  return JSON.stringify(treeList);
}

module.exports = router;
