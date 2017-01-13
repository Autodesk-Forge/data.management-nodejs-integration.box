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
var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();

// config information, such as client ID and secret
var config = require('./config');

// box sdk: https://github.com/box/box-node-sdk/
var BoxSDK = require('box-node-sdk');

// forge 
var ForgeDataManagement = require('forge-data-management');
var ForgeOSS = require('forge-oss');

var request = require('request');

router.post('/integration/sendToBox', jsonParser, function (req, res) {
  var tokenSession = new token(req.session);
  if (!tokenSession.isAuthorized()) {
    res.status(401).json({error: 'Please login first'});
    return;
  }
  // Configure OAuth2 access token for authorization: oauth2_access_code
  var defaultClient = ForgeDataManagement.ApiClient.instance;
  var oauth = defaultClient.authentications ['oauth2_access_code'];
  oauth.accessToken = tokenSession.getTokenInternal();

  // file IDs to transfer
  var autodeskFileId = decodeURIComponent(req.body.autodeskfile);
  var boxFolderId = req.body.boxfolder;

  // the autodesk file id parameters should be in the form of
  // /data/v1/projects/::project_id::/versions/::version_id::
  var params = autodeskFileId.split('/');
  var projectId = params[params.length - 3];
  var versionId = params[params.length - 1];

  var versions = new ForgeDataManagement.VersionsApi();
  versions.getVersion(projectId, versionId).then(function (version) {
    if (!version.data.relationships.storage || !version.data.relationships.storage.meta.link.href) {
      res.status(500).json({error: 'No storage defined, cannot transfer.'});
      return;
    }
    var storageLocation = version.data.relationships.storage.meta.link.href;
    // the storage location should be in the form of
    // /oss/v2/buckets/::bucketKey::/objects/::objectName::
    params = storageLocation.split('/');
    var bucketKey = params[params.length - 3];
    var objectName = params[params.length - 1];

    var defaultOSSClient = ForgeOSS.ApiClient.instance;
    var oauthOSS = defaultOSSClient.authentications ['oauth2_application']; // not the 'oauth2_access_code', as per documentation
    oauthOSS.accessToken = tokenSession.getTokenInternal();
    var objects = new ForgeOSS.ObjectsApi();

    // npm forge-oss call to download not working
    //objects.getObject(bucketKey, objectName).then(function (file) {

    // workaround to download
    request({
      url: storageLocation,
      method: "GET",
      headers: {
        'Authorization': 'Bearer ' + tokenSession.getTokenInternal(),
      },
      encoding: null
    }, function (error, response, file) {
      if (error) console.log(error);
      // end of workaround

      var sdk = new BoxSDK({
        clientID: config.box.credentials.client_id, // required
        clientSecret: config.box.credentials.client_secret // required
      });

      var box = sdk.getBasicClient(tokenSession.getBoxToken());
      box.files.uploadFile(boxFolderId, version.data.attributes.name, file, function (err, data) {
        if (err)
          res.status(500).json({error: err.message});
        else
          res.status(200).json({file: version.data.attributes.name});
        return;
      });
    });//.catch(function (e) { res.status(e.error.statusCode).json({error: e.error.body}) });
  }).catch(function (e) { res.status(e.error.statusCode).json({error: e.error.body}) });
});

router.post('/integration/sendToAutodesk', jsonParser, function (req, res) {
  var tokenSession = new token(req.session);
  if (!tokenSession.isAuthorized()) {
    res.status(401).json({error: 'Please login first'});
    return;
  }
  // Configure OAuth2 access token for authorization: oauth2_access_code
  var defaultClient = ForgeDataManagement.ApiClient.instance;
  var oauth = defaultClient.authentications ['oauth2_access_code'];
  oauth.accessToken = tokenSession.getTokenInternal();

  var projects = new ForgeDataManagement.ProjectsApi();

  // file IDs to transfer
  var autodeskType = req.body.autodesktype; // projects or folders
  var autodeskId = decodeURIComponent(req.body.autodeskid);
  var boxFileId = req.body.boxfile;

  var projectId;
  var folderId;
  var params = autodeskId.split('/');
  switch (autodeskType) {
    case "folders":
      projectId = params[params.length - 3];
      folderId = params[params.length - 1];
      sendToAutodesk(projectId, folderId, boxFileId, res, req);
      break;
    case "projects":
      projectId = params[params.length - 1];
      var hubId = params[params.length - 3];
      projects.getProject(hubId, projectId).then(function (project) {
        folderId = project.data.relationships.rootFolder.data.id;
        sendToAutodesk(projectId, folderId, boxFileId, res, req);
      });
      break;
  }
});

function sendToAutodesk(projectId, folderId, boxFileId, res, req) {
  var tokenSession = new token(req.session);
  var sdk = new BoxSDK({
    clientID: config.box.credentials.client_id, // required
    clientSecret: config.box.credentials.client_secret // required
  });
  var box = sdk.getBasicClient(tokenSession.getBoxToken());
  box.files.get(boxFileId, null, function (err, fileInfo) {
    var fileName = fileInfo.name;
    var projects = new ForgeDataManagement.ProjectsApi();
    projects.postStorage(projectId, JSON.stringify(storageSpecData(fileName, folderId))).then(function (storage) {
      var objectId = storage.data.id;
      var bucketKey = getBucketKeyObjectName(objectId).bucketKey;
      var objectName = getBucketKeyObjectName(objectId).objectName;

      box.files.getReadStream(boxFileId, null, function (err, filestream) {
        var mineType = getMineType(fileName);

        //var defaultOSSClient = ForgeOSS.ApiClient.instance;
        //var oauthOSS = defaultOSSClient.authentications ['oauth2_application']; // not the 'oauth2_access_code', as per documentation
        //oauthOSS.accessToken = tokenSession.getTokenInternal();
        //var objects = new ForgeOSS.ObjectsApi();

        // this request should be done via ObjectsApi.uploadObject call
        // but it's missing the header, so using this workaround for now
        request({
          url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + bucketKey + '/objects/' + objectName,
          method: "PUT",
          headers: {
            'Authorization': 'Bearer ' + tokenSession.getTokenInternal(),
            'Content-Type': mineType
          },
          body: filestream
        }, function (error, response, body) {
          projects.postItem(projectId, JSON.stringify(versionSpecData(fileName, folderId, objectId))).then(function (version) {
            res.status(200).json({file: version.data.attributes.displayName});
          });
        });
      });
    });
  });
}

function getBucketKeyObjectName(objectId) {
  // the objectId comes in the form of
  // urn:adsk.objects:os.object:BUCKET_KEY/OBJECT_NAME
  var objectIdParams = objectId.split('/');
  var objectNameValue = objectIdParams[objectIdParams.length - 1];
  // then split again by :
  var bucketKeyParams = objectIdParams[objectIdParams.length - 2].split(':');
  // and get the BucketKey
  var bucketKeyValue = bucketKeyParams[bucketKeyParams.length - 1];

  var ret =
  {
    bucketKey: bucketKeyValue,
    objectName: objectNameValue
  };
  return ret;
}

function storageSpecData(fileName, folderId) {
  var storageSpecs =
  {
    data: {
      type: 'objects',
      attributes: {
        name: fileName
      },
      relationships: {
        target: {
          data: {
            type: 'folders',
            id: folderId
          }
        }
      }
    }
  };
  return storageSpecs;
}

function versionSpecData(filename, folderId, objectId) {
  var versionSpec =
  {
    jsonapi: {
      version: "1.0"
    },
    data:
      {
        type: "items",
        attributes: {
          displayName: filename,
          extension: {
            type: "items:autodesk.core:File",
            version: "1.0"
          }
        },
        relationships: {
          tip: {
            data: {
              type: "versions",
              id: "1"
            }
          },
          parent: {
            data: {
              type: "folders",
              id: folderId
            }
          }
        }
      },
    included: [
      {
        type: "versions",
        id: "1",
        attributes: {
          name: filename,
          extension:{
            type: "versions:autodesk.core:File",
            version: "1.0"
          }
        },
        relationships: {
          storage: {
            data: {
              type: "objects",
              id: objectId
            }
          }
        }
      }
    ]
  };
  return versionSpec;
}

function getMineType(fileName) {
  var re = /(?:\.([^.]+))?$/; // regex to extract file extension
  var extension = re.exec(fileName)[1];
  var types = {
    'png': 'application/image',
    'jpg': 'application/image',
    'txt': 'application/txt',
    'ipt': 'application/vnd.autodesk.inventor.part',
    'iam': 'application/vnd.autodesk.inventor.assembly',
    'dwf': 'application/vnd.autodesk.autocad.dwf',
    'dwg': 'application/vnd.autodesk.autocad.dwg',
    'f3d': 'application/vnd.autodesk.fusion360',
    'f2d': 'application/vnd.autodesk.fusiondoc',
    'rvt': 'application/vnd.autodesk.revit'
  };
  return (types[extension] != null ? types[extension] : 'application/' + extension);
}

module.exports = router;