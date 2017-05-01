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

// forge oAuth package
var forgeSDK = require('forge-apis');

// forge config information, such as client ID and secret
var config = require('./config');

var request = require('request');

// this end point will logoff the user by destroying the session
// as of now there is no Forge endpoint to invalidate tokens
router.get('/user/logoff', function (req, res) {
  req.session.destroy();
  res.end('/');
});

// return name & picture of the user for the front-end
// the forge @me endpoint returns more information
router.get('/user/profile', function (req, res) {
  var tokenSession = new token(req.session);
  if (!tokenSession.isAuthorized()) {
    res.status(401).end('Please login first');
    return;
  }

  request({
    url: "https://developer.api.autodesk.com/userprofile/v1/users/@me",
    method: "GET",
    headers: {
      'Authorization': 'Bearer ' + tokenSession.getInternalCredentials().access_token
    }
  }, function (error, response, body) {
    if (error != null) {
      console.log(error); // connection problems

      if (body.errors != null)
        console.log(body.errors);

      console.log(error);

      return;
    }

    var json = JSON.parse(body);
    var profile = {
      'name': json.firstName + ' ' + json.lastName,
      'picture': json.profileImages.sizeX20
    };

    res.json(profile);
  })
});

// return the public token of the current user
// the public token should have a limited scope (read-only)
router.get('/user/token', function (req, res) {
  var tokenSession = new token(req.session);
  if (!tokenSession.isAuthorized()) {
    res.end("");

    return;
  }

  res.end(tokenSession.getPublicCredentials().access_token);
});

// return the forge authenticate url
router.get('/user/authenticate', function (req, res) {
  // redirect the user to this page
  var url =
    "https://developer.api.autodesk.com" +
    '/authentication/v1/authorize?response_type=code' +
    '&client_id=' + config.credentials.client_id +
    '&redirect_uri=' + config.callbackURL +
    '&scope=' + config.scopeInternal.join(" ");
  res.end(url);
});

// wait for Autodesk callback (oAuth callback)
router.get('/api/forge/callback/oauth', function (req, res) {
  var code = req.query.code;
  var tokenSession = new token(req.session);

  // first get a full scope token for internal use (server-side)
  var req = new forgeSDK.AuthClientThreeLegged(config.credentials.client_id, config.credentials.client_secret, config.callbackURL, config.scopeInternal);
  console.log(code);
  req.getToken(code)
    .then(function (internalCredentials) {

      tokenSession.setInternalCredentials(internalCredentials);
      tokenSession.setInternalOAuth(req);

      console.log('Internal token (full scope): ' + internalCredentials.access_token); // debug

      // then refresh and get a limited scope token that we can send to the client
      var req2 = new forgeSDK.AuthClientThreeLegged(config.credentials.client_id, config.credentials.client_secret, config.callbackURL, config.scopePublic);
      req2.refreshToken(internalCredentials)
        .then(function (publicCredentials) {
          tokenSession.setPublicCredentials(publicCredentials);
          tokenSession.setPublicOAuth(req2);

          console.log('Public token (limited scope): ' + publicCredentials.access_token); // debug
          res.redirect('/');
        })
        .catch(function (error) {
          console.log(error);
        });
    })
    .catch(function (error) {
      console.log(error);
    });
});

module.exports = router;