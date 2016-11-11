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

// forge
var ForgeDataManagement = require('forge-data-management');

router.get('/dm/getTreeNode', function (req, res) {
  var tokenSession = new token(req.session);
  if (!tokenSession.isAuthorized()) {
    res.status(401).end('Please login first');
    return;
  }

  // Configure OAuth2 access token for authorization: oauth2_access_code
  var defaultClient = ForgeDataManagement.ApiClient.instance;
  var oauth = defaultClient.authentications ['oauth2_access_code'];
  oauth.accessToken = tokenSession.getTokenInternal();


  // which tree node?
  var id = decodeURIComponent(req.query.id);

  if (id == '#') {
    // # stands for ROOT
    var hubs = new ForgeDataManagement.HubsApi();
    hubs.getHubs().then(function (data) {
      res.end(prepareArrayForJSTree(data.data, true));
    }).catch(function (error) { res.status(500).end(error); });
  }
  else {
    var params = id.split('/');
    var resourceName = params[params.length - 2];
    var resourceId = params[params.length - 1];
    switch (resourceName) {
      case 'hubs':
        // if the caller is a hub, then show projects
        var hubs = new ForgeDataManagement.HubsApi();
        hubs.getHubProjects(resourceId).then(function (hubs) {
          res.end(prepareArrayForJSTree(hubs.data, true));
        }).catch(function (error) { res.status(500).end(error); });
        break;
      case 'projects':
        // if the caller is a project, then show folders
        var hubId = params[params.length - 3];
        var project = new ForgeDataManagement.ProjectsApi();
        project.getProject(hubId, resourceId).then(function (project) {
          var folder = new ForgeDataManagement.FoldersApi();
          var rootFolderId = project.data.relationships.rootFolder.data.id;
          folder.getFolderContents(project.data.id, rootFolderId).then(function (folderContents) {
            res.end(prepareArrayForJSTree(folderContents.data, true));
          }).catch(function (error) {res.end(error);});
        }).catch(function (error) { res.end(error); });
        break;
      case 'folders':
        // if the caller is a folder, then show contents
        var projectId = params[params.length - 3];
        var folder = new ForgeDataManagement.FoldersApi();
        folder.getFolderContents(projectId, resourceId).then(function (folderContents) {
          res.end(prepareArrayForJSTree(folderContents.data, true));
        }).catch(function (error) {res.end(error);});
        break;
      case 'items':
        // if the caller is an item, then show versions
        var projectId = params[params.length - 3];
        var items = new ForgeDataManagement.ItemsApi();
        items.getItemVersions(projectId, resourceId/*item_id*/).then(function(itemVersions){
          res.end(prepareArrayForJSTree(itemVersions.data, false));
        }).catch(function (error) { res.end(error); });
        break;
    }
  }
});

// Formats a list to JSTree structure
function prepareArrayForJSTree(listOf, canHaveChildren, data) {
  if (listOf == null) return '';
  var treeList = [];
  listOf.forEach(function (item, index) {
    var treeItem = {
      id: item.links.self.href,
      data: (item.relationships != null && item.relationships.derivatives != null ? item.relationships.derivatives.data.id : null),
      text: (item.attributes.displayName == null ? item.attributes.name : item.attributes.displayName),
      type: item.type,
      children: canHaveChildren
    };
    treeList.push(treeItem);
  });
  return JSON.stringify(treeList);
}

module.exports = router;
