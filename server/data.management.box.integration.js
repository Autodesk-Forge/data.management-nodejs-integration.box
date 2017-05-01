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
var forgeSDK = require('forge-apis');
//var ForgeDataManagement = require('forge-data-management');
//var ForgeOSS = require('forge-oss');

var request = require('request');

function respondWithError(res, error) {
  if (error.statusCode) {
    res.status(error.statusCode).end(error.statusMessage);
  } else {
    res.status(500).end(error.message);
  }
}

router.post('/integration/sendToBox', jsonParser, function (req, res) {
  var tokenSession = new token(req.session);
  if (!tokenSession.isAuthorized()) {
    res.status(401).json({error: 'Please login first'});
    return;
  }

  // file IDs to transfer
  var autodeskFileId = decodeURIComponent(req.body.autodeskfile);
  var boxFolderId = req.body.boxfolder;

  // the autodesk file id parameters should be in the form of
  // /data/v1/projects/::project_id::/versions/::version_id::
  var params = autodeskFileId.split('/');
  var projectId = params[params.length - 3];
  var versionId = params[params.length - 1];

  var versions = new forgeSDK.VersionsApi();
  versions.getVersion(projectId, versionId, tokenSession.getInternalOAuth(), tokenSession.getInternalCredentials())
    .then(function (version) {
      if (!version.body.data.relationships.storage || !version.body.data.relationships.storage.meta.link.href) {
        res.status(500).json({error: 'No storage defined, cannot transfer.'});
        return;
      }
      var storageLocation = version.body.data.relationships.storage.meta.link.href;
      // the storage location should be in the form of
      // /oss/v2/buckets/::bucketKey::/objects/::objectName::
      params = storageLocation.split('/');
      var bucketKey = params[params.length - 3];
      var objectName = params[params.length - 1];

      // workaround to download
      request({
        url: storageLocation,
        method: "GET",
        headers: {
          'Authorization': 'Bearer ' + tokenSession.getInternalCredentials().access_token
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
        box.files.uploadFile(boxFolderId, version.body.data.attributes.name, file, function (err, data) {
          if (err)
            res.status(500).json({error: err.message});
          else
            res.status(200).json({file: version.body.data.attributes.name});
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
      var projects = new forgeSDK.ProjectsApi();
      projects.getProject(hubId, projectId,
        tokenSession.getInternalOAuth(), tokenSession.getInternalCredentials())
        .then(function (project) {
          folderId = project.body.data.relationships.rootFolder.data.id;
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
    var fileSize = fileInfo.size;

    request({
      url: 'https://api.box.com/2.0/files/'+boxFileId+'/content',
      method: "GET",
      headers: {
        'Authorization': 'Bearer ' + tokenSession.getBoxToken()
      },
      encoding: null
    }, function(error, response, body) {

    //
    //box.files.getReadStream(boxFileId, null, function (err, filestream) {
      var mineType = getMineType(fileName);
      var projects = new forgeSDK.ProjectsApi();
      projects.postStorage(projectId, JSON.stringify(storageSpecData(fileName, folderId)),
        tokenSession.getInternalOAuth(), tokenSession.getInternalCredentials())
        .then(function (storageData) {
          var objectId = storageData.body.data.id;
          var bucketKey = getBucketKeyObjectName(objectId).bucketKey;
          var objectName = getBucketKeyObjectName(objectId).objectName;


          uploadFile(projectId, folderId, fileName, body.length, body, req)
            .then(function (objectId) {
              createNewItemOrVersion(projectId, folderId, fileName, objectId, req)
                .then(function (versionId) {
                  var str = "";
                  res.status(200).json({result: "OK", file: fileName});
                })
                .catch(function (error) {
                  var str = "";
                  respondWithError(res, error);
                });
            })
            .catch(function (error) {
              respondWithError(res, error);
            });
        }).catch(function(err){
          console.log(err);
      });
    });
  });
}

function withoutExtension(fileName) {
  // Remove the last ".<extension>"
  // e.g.:
  // my.file.jpg >> my.file
  // myfile >> myfile
  return fileName.replace(/(.*)\.(.*?)$/, "$1");
}

function uploadFile(projectId, folderId, fileName, fileSize, fileData, req) {
  return new Promise(function (_resolve, _reject) {
    try {
      // Ask for storage for the new file we want to upload
      var tokenSession = new token(req.session);
      var projects = new forgeSDK.ProjectsApi();
      projects.postStorage(projectId, JSON.stringify(storageSpecData(fileName, folderId)),
        tokenSession.getInternalOAuth(), tokenSession.getInternalCredentials())
        .then(function (storageData) {
          var objectId = storageData.body.data.id;
          var bucketKeyObjectName = getBucketKeyObjectName(objectId);

          // Upload the new file
          var objects = new forgeSDK.ObjectsApi();
          objects.uploadObject(
            bucketKeyObjectName.bucketKey, bucketKeyObjectName.objectName, fileSize, fileData,
            {}, tokenSession.getInternalOAuth(), tokenSession.getInternalCredentials())
            .then(function (objectData) {
              console.log('uploadObject: succeeded');
              _resolve(objectData.body.objectId);
            })
            .catch(function (error) {
              console.log('uploadObject: failed');
              _reject(error);
            });

        })
        .catch(function (error) {
          _reject(error);
        });
    } catch (err) {
      _reject(err);
    }
  });
}

function createNewItemOrVersion(projectId, folderId, fileName, objectId, req) {
  return new Promise(function (_resolve, _reject) {
    try {
      var tokenSession = new token(req.session);

      var folders = new forgeSDK.FoldersApi();
      folders.getFolderContents(projectId, folderId, {},
        tokenSession.getInternalOAuth(), tokenSession.getInternalCredentials())
        .then(function (folderData) {
          var item = null;
          for (var key in folderData.body.data) {
            item = folderData.body.data[key];
            if (item.attributes.displayName === fileName || item.attributes.displayName === withoutExtension(fileName)) {
              break;
            } else {
              item = null;
            }
          }

          if (item) {
            // We found it so we should create a new version
            var versions = new forgeSDK.VersionsApi();
            var body = JSON.stringify(versionSpecData(fileName, projectId, item.id, objectId));
            versions.postVersion(projectId, body,
              tokenSession.getInternalOAuth(), tokenSession.getInternalCredentials())
              .then(function (versionData) {
                _resolve(versionData.body.data.id);
              })
              .catch(function (error) {
                console.log('postVersion: failed' + error);

                _reject(error);
              });
          } else {
            // We did not find it so we should create it
            var items = new forgeSDK.ItemsApi();
            var body = JSON.stringify(itemSpecData(fileName, projectId, folderId, objectId));
            items.postItem(projectId, body,
              tokenSession.getInternalOAuth(), tokenSession.getInternalCredentials())
              .then(function (itemData) {
                // Get the versionId out of the reply
                _resolve(itemData.body.included[0].id);
              })
              .catch(function (error) {
                console.log('postItem: failed' + error);

                _reject(error);
              });
          }
        })
        .catch(function (error) {
          console.log('getFolderContents: failed' + error);
          _reject(error);
        });
    } catch (err) {
      _reject(err);
    }
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

function itemSpecData(fileName, projectId, folderId, objectId) {
  var itemsType = projectId.startsWith("a.") ? "items:autodesk.core:File" : "items:autodesk.bim360:File";
  var versionsType = projectId.startsWith("a.") ? "versions:autodesk.core:File" : "versions:autodesk.bim360:File";
  var itemSpec = {
    jsonapi: {
      version: "1.0"
    },
    data: {
      type: "items",
      attributes: {
        displayName: fileName,
        extension: {
          type: itemsType,
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
    included: [{
      type: "versions",
      id: "1",
      attributes: {
        name: fileName,
        extension: {
          type: versionsType,
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
    }]
  };

  if (fileName.endsWith(".iam.zip")) {
    itemSpec.data[0].attributes.extension.type = "versions:autodesk.a360:CompositeDesign";
    itemSpec.data[0].attributes.name = fileName.slice(0, -4);
    itemSpec.included[0].attributes.name = fileName.slice(0, -4);
  }

  console.log(itemSpec);

  return itemSpec;
}

function versionSpecData(fileName, projectId, itemId, objectId) {
  var versionsType = projectId.startsWith("a.") ? "versions:autodesk.core:File" : "versions:autodesk.bim360:File";

  var versionSpec = {
    "jsonapi": {
      "version": "1.0"
    },
    "data": {
      "type": "versions",
      "attributes": {
        "name": fileName,
        "extension": {
          "type": versionsType,
          "version": "1.0"
        }
      },
      "relationships": {
        "item": {
          "data": {
            "type": "items",
            "id": itemId
          }
        },
        "storage": {
          "data": {
            "type": "objects",
            "id": objectId
          }
        }
      }
    }
  }

  if (fileName.endsWith(".iam.zip")) {
    versionSpec.data.attributes.extension.type = "versions:autodesk.a360:CompositeDesign";
    versionSpec.data.attributes.name = fileName.slice(0, -4);
  }

  console.log(versionSpec);

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