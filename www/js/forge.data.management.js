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

$(document).ready(function () {
  $('#refreshAutodeskTree').hide();
  if (getForgeToken() != '') {
    prepareDataManagementTree();
    $('#refreshAutodeskTree').show();
    $('#refreshAutodeskTree').click(function(){
      $('#myAutodeskFiles').jstree(true).refresh();
    });
  }
});

function prepareDataManagementTree() {
  $('#myAutodeskFiles').jstree({
    'core': {
      'themes': {"icons": true},
      'data': {
        "url": '/dm/getTreeNode',
        "dataType": "json",
        'multiple': false,
        "data": function (node) {
          return {"id": node.id};
        }
      }
    },
    'types': {
      'default': {
        'icon': 'glyphicon glyphicon-cloud'
      },
      '#': {
        'icon': 'glyphicon glyphicon-user'
      },
      'hubs': {
        'icon': 'glyphicon glyphicon-inbox'
      },
      'projects': {
        'icon': 'glyphicon glyphicon-list-alt'
      },
      'items': {
        'icon': 'glyphicon glyphicon-file'
      },
      'folders': {
        'icon': 'glyphicon glyphicon-folder-open'
      },
      'versions': {
        'icon': 'glyphicon glyphicon-time'
      }
    },
    "plugins": ["types", "state", "sort", "contextmenu"],
    contextmenu: {items: autodeskCustomMenu}
  });
}

function autodeskCustomMenu(autodeskNode) {
  var items;

  if (autodeskNode.type == 'versions') {
    items = {
      sendToBox: {
        label: "Send to Box",
        icon: "/img/box-logo.png",
        action: function () {
          var boxNode = $('#myBoxFiles').jstree(true).get_selected(true)[0];
          sendToBox(autodeskNode, boxNode);
        }
      }
    };
  }

  return items;
}

function sendToBox(autodeskNode, boxNode) {
  if (boxNode == null || boxNode.type != 'folder') {
    $.notify('Please select a folder on Box Folders', 'error');
    return;
  }
  $.notify('Preparing to send file "' + autodeskNode.text + '" to "' + boxNode.text + '" box ' + boxNode.type, 'info');

  jQuery.ajax({
    url: '/integration/sendToBox',
    contentType: 'application/json',
    type: 'POST',
    dataType: 'json',
    data: JSON.stringify({
      'autodeskfile': autodeskNode.id,
      'boxfolder': boxNode.id
    }),
    success: function (res) {
      $.notify('Transfer of file "' + res.file + '" completed', 'info');
      $('#myBoxFiles').jstree(true).refresh_node(boxNode);
    },
    error: function (res) {
      res = JSON.parse(res.responseText);
      $.notify(res.error, 'error');
    }
  });
}