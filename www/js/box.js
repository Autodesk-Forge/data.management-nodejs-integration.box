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
  var auth = isBoxAuthorized();
  if (!isBoxAuthorized()) {
    $('#refreshBoxTree').hide();
    $('#loginBox').click(boxSignIn);
  }
  else {
    $('#loginBox').hide();
    $('#refreshBoxTree').show();
    $('#refreshBoxTree').click(function(){
      $('#myBoxFiles').jstree(true).refresh();
    });
    prepareBoxTree();
  }
});

function boxSignIn() {
  jQuery.ajax({
    url: '/box/authenticate',
    success: function (rootUrl) {
      location.href = rootUrl;
    }
  });
}

function isBoxAuthorized() {
  var ret = 'false';
  jQuery.ajax({
    url: '/box/isAuthorized',
    success: function (res) {
      ret = res;
    },
    async: false // this request must be synchronous for the Forge Viewer
  });
  return (ret === 'true');
}

function prepareBoxTree() {
  $('#myBoxFiles').jstree({
    'core': {
      'themes': {"icons": true},
      'data': {
        "url": '/box/getTreeNode',
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
      'file': {
        'icon': 'glyphicon glyphicon-file'
      },
      'folder': {
        'icon': 'glyphicon glyphicon-folder-open'
      }
    },
    "plugins": ["types", "state", "sort", "contextmenu"],
    contextmenu: {items: boxCustomMenu}
  });
}

function boxCustomMenu(boxNode) {
  var items;

  if (boxNode.type == 'file') {
    items = {
      renameItem: {
        label: "Send to Autodesk",
        icon: "/img/autodesk-forge.png",
        action: function () {
          var autodeskNode = $('#myAutodeskFiles').jstree(true).get_selected(true)[0];
          sendToAutodesk(boxNode, autodeskNode);
        }
      }
    };
  }
  return items;
}

var re = /(?:\.([^.]+))?$/; // regex to extract file extension

function sendToAutodesk(boxNode, autodeskNode) {
  if (autodeskNode == null || (autodeskNode.type != 'projects' && autodeskNode.type != 'folders')) {
    $.notify('Please select a Project or Folder on Autodesk Hubs', 'error');
    return;
  }

  isFileSupported(re.exec(boxNode.text)[1], function (supported) {
    if (!supported) {
      $.notify('File "' + boxNode.text + '" cannot be translated to Forge Viewer', 'warn');
    }

    $.notify('Preparing to send file "' + boxNode.text + '" to "' + autodeskNode.text + '" Autodesk ' + autodeskNode.type, 'info');

    jQuery.ajax({
      url: '/integration/sendToAutodesk',
      contentType: 'application/json',
      type: 'POST',
      dataType: 'json',
      data: JSON.stringify({
        'autodesktype': autodeskNode.type, // projects or folders
        'autodeskid': autodeskNode.id,
        'boxfile': boxNode.id
      }),
      success: function (res) {
        $.notify('Transfer of file "' + res.file + '" completed', 'info');
        $('#myAutodeskFiles').jstree(true).refresh_node(autodeskNode);
      },
      error: function (res) {
        $.notify(res.error, 'error');
      }
    });

  });
}

function isFileSupported(extension, callback) {
  jQuery.ajax({
    url: '/md/formats',
    contentType: 'application/json',
    type: 'GET',
    dataType: 'json',
    success: function (supportedFormats) {
      callback(( jQuery.inArray(extension, supportedFormats) >= 0));
    }
  });
}