// Central point of interractions
DEFAULT_PUSH_INTERVAL = 2000; // ms
communicator = null;
tree = null;

// 
CHANGE_RM_TYPE = -1;
CHANGE_ADD_TYPE = 1; 

// Requests
HOST = window.location.host;
RETRY_CONNECT_TIMEOUT = 2000; // ms

// Initialize content when ready
$(document).ready(init);
function init() {
  tree = new ProjectTreeView();
  tree.initRoot("tree", "ProjectName");

  // Classes
  communicator = new Communicator();
  communicator.init('editorLastVersion', 'editorDisplay');

  // Quick hack
  communicator.showFileContent(communicator._openedFile);
}


// TEST_ONLY
function addNewTextAt(){
  var content = $('#addText').val();
  var at = parseInt($('#addAt').val());
  var modA = createAddModif(content, at);
  communicator.notifySoft(createModifGroup([modA], "fileName", 0));
}

function removeTextAt() {
  var count = parseInt($('#rmCountText').val());
  var at = parseInt($('#rmAt').val());
  var modA = createRemoveModif(count, at);
  communicator.notifySoft(createModifGroup([modA], "fileName", 0));
}

function test_ajax() {
  var modObject = createModif("abc", 0);
  var modifObject = createModifGroup([modObject], "fileName", 0);
  communicator._requestHandler.post("save", modifObject, function(){
    console.log("Success reveived comm");
    communicator._changeMemory.clear();
  });
}

function test_AddNode() {
  var nodeName = $('#textNode').val();
  tree.addNode(nodeName);
}

function test_RemoveNode() {
  var nodeName = $('#textNode').val();
  tree.removeNode(nodeName);
}

function test_ManyAddNode() {
  tree.addNode('file-toto');
  tree.addNode('dir-toto/');

  tree.addNode('/d/');
  tree.addNode('d/sub-toto-file');
  tree.addNode('d/sub-toto-dir/');
}

// #####################################
// #####                           #####
// #####          Classes          #####
// #####                           #####
// #####################################

/* Central class that will interact will all other classes. */
function Communicator(pushInterval) {

  // Setup event handlers
  var obj = this; // For closure

  // This will be used to store the value inside
  // the data attribute at the following key
  this._DATA_TEXT_KEY = "saved-text";

  // 

  this._openedFile = undefined;
  this._fileRevision = undefined;

  this._difftool = null;

  // Quick hack
  // wait to receive projet tree
  // wait for user to select file
  // Suppose user selected main.py
  this._openedFile = "main.py";

  // Handle null value
  this._pushInterval = pushInterval || DEFAULT_PUSH_INTERVAL;
  this._pushIntervalHandle = null;

  this._changeMemory = null;
  this._zoneLastVersion = null;
  this._zoneDisplay = null;

  this._nodeDisplay = null;
  

  this.init = function(lastVersionZoneId, displayZoneId) {

    // Get a ref to edit nodes
    var nodeLastVersion = $("#" + lastVersionZoneId);
    this._nodeDisplay = $("#" + displayZoneId);

    // Required to get cursor position on contentEditable pre tag
    var elementDisplay = document.getElementById(displayZoneId);

    // Create classes
    this._changeMemory = new LocalChanges();
    this._zoneLastVersion = new LastVersionZone(nodeLastVersion);
    this._zoneDisplay = new DisplayZone(this._nodeDisplay);

    // Handle ways of sending and receiving data from/to server
    this._requestHandler = new RequestHandler(HOST, this.receive);
    this._requestHandler.init();

    // Diff lib to compare two texts
    this._difftool = new diff_match_patch();
    
    // Initialize stored text data attribute
    this._nodeDisplay.data(this._DATA_TEXT_KEY, this._nodeDisplay.text() || ""); 
    
    // Push changes handler 
    this._pushIntervalHandle = setInterval( 
      function() {
        return; //<<debug>> ... remove this line to send changes to controller
        // try push
        var changes = obj._changeMemory.get();
        if(changes.length == 0) 
          return;

        // Send and clear on success
        var modifObject = createModifGroup(changes, obj._openedFile, obj._fileRevision);
        obj._requestHandler.put("save", modifObject, function(){
          // Will I delete new input ??
          console.log("Changes sent, clear local changes");
          obj._changeMemory.clear();
        });
      },
      this._pushInterval
    );

    // Local and display sync handler
    this._nodeDisplay.bind("input paste", this._handleInputEvent);

    var msg = "DEBUG MODE :\n";
    msg +=    "Add and remove feature works locally.\n";
    msg +=    "They are not robust (garbage in, garbage out).\n";
    msg +=    "Unittest infrastructure will be comming next.\n\n";
    msg +=    "No messages are sent to the controller.\n";
    msg +=    "To reactivate that, look for <<debug>> in source code.\n";
    alert(msg);
  };

  this._handleInputEvent = function(evt) {
    // Get old value, compare and store new
    // $(this) corresponds to nodeDisplay
    var oldText = obj._nodeDisplay.data(obj._DATA_TEXT_KEY);
    var newText = obj._nodeDisplay.text();
    if(oldText == newText) return; // paste events are trigged early
    obj._nodeDisplay.data(obj._DATA_TEXT_KEY, newText); 

    // https://code.google.com/p/google-diff-match-patch/wiki/API
    // A diff is a pair (type, text) where type is 1 for addition,
    // 0  for 'no-change' and -1 for substraction
    var diff = obj._difftool.diff_main(oldText, newText);
    // Since this function is triggered after one change,
    // which corresponds to a maximum of two diff elements,
    // position needs to be computed over iteration
    // -- Add text : 1 diff add element
    // -- Remove text : 1 diff remove element
    // -- Highlight text and add text : 1 diff add element and 1 diff remove element 
    var at = 0;
    diff.map(function(change){
      switch(change[0]) {
        case -1:
          obj._changeMemory.removeChange(at+change[1].length, change[1].length);
          break;
        case 1:
          obj._changeMemory.addChange(at, change[1]);
          // no break on purpose
        case 0:     
          at += change[1].length;
          break;
      }
    });     
  };

  this.showFileContent = function(filepath) {
    // force send any pending changes on current file (if any)
    // TODO changeFileState class

    // Do request
    this._requestHandler.post("open", createOpen(filepath), function(response){
      // on success
      obj._fileRevision = response.vers;
      obj.notifyForce(createAddModif(response.content, 0));
      // Save content in data attributes
      obj._nodeDisplay.data(obj._DATA_TEXT_KEY, response.content);
    });
  };

  this._updateDisplayNoEvent = function(text) {
    // Hack to avoid considering server text as the user input
    this._nodeDisplay.unbind("input paste");
    this._zoneDisplay.update(text);
    this._nodeDisplay.bind("input paste", this._handleInputEvent);
  };

  // Data received from server
  this.receive = function(opCode, jsonObj){
    // Check if opCode means fileAdd

    // opCode is textEdit
    obj.notifySoft(jsonObj);
  };

  // Does not receive a group of modifications since
  // every zone will be overriden. One delta is enough
  this.notifyForce = function(initialDelta) {
    this._zoneLastVersion.put(initialDelta.content);
    this._changeMemory.clear();
    this._updateDisplayNoEvent(initialDelta.content); 
  };

  this.notifySoft = function(modifications) {
    this._changeMemory.update(modifications.changes);
    this._zoneLastVersion.update(modifications.changes);
    this._updateDisplayNoEvent(this._combineText());
  };

  this._combineText = function() {
    var base = this._zoneLastVersion.get();
    var modifs = this._changeMemory.get();
    modifs.map(function(mod) {
      base = mod.type == CHANGE_RM_TYPE ?
        base.cut(mod.pos, mod.pos+mod.count):
        base.insert(mod.content, mod.pos);
    });
    return base;
  };
};

/* Visible section by the user */
function DisplayZone(node){
  this._zone = node;

  this.update = function(text){
    this._zone.text(text);
  };
}

/* Class to store the last version of the file received by
the server. It is updated by applying every delta. */
function LastVersionZone(node) {
  this._zone = node;

  this.update = function(modifications) {
    var changedContent = this._zone.val();
    modifications.map(function(mod) {
      changedContent = mod.type == CHANGE_RM_TYPE ?
        // Remove
        (changedContent.slice(0, mod.pos - mod.count) + changedContent.slice(mod.pos)) :
        // Add
        (changedContent.slice(0, mod.pos) + mod.content + changedContent.slice(mod.pos));
    });
    
    this._zone.val(changedContent);
  };

  this.put = function(text) {
    this._zone.val(text);
  };

  this.get = function() {
     return this._zone.val();
  };
}


/* Class to store all changes done by the user */
function LocalChanges() {

  // Reuse the same states to accelerate
  this._removeState = new LocalChangeRemoveState(this);
  this._addState = new LocalChangeAddState(this);

  // First state
  this._state = this._addState;
  this._state.init();

  this._modifications = [];
}
LocalChanges.prototype.get = function() {
  if(this._state.isChangeInProgress())
    this.saveChange(this._state.getPendingChange())
    this._state.init();
  return this._modifications.dcopy();
};
LocalChanges.prototype.update = function(deltas) {
  /* At request was received from the server.
  It can be additions, or removals or both.
  All saved offset need to be updated */
  deltas.map(function(delta) {
    // For stored change
    this._modifications.map(function(mod) {
      if(delta.pos < mod.pos) {
        mod.pos += delta.type == CHANGE_RM_TYPE ?
          -delta.count :
          delta.content.length;
      }
    });
    // For current change, when defined
    this._state.update(delta);
  }, this);
};
LocalChanges.prototype.clear = function() {
  this._modifications.clear();
  this._state.init();
};
LocalChanges.prototype.addChange = function(at, val) { 
  if(!val) return;
  this._state.add(at, val); 
};
LocalChanges.prototype.removeChange = function(at, count) { 
  if(!count) return;
  this._state.remove(at, count); 
};
LocalChanges.prototype.handleSwitchToAddState = function(val, at){
  // Get any pending change to avoid data miss
  if(this._state.isChangeInProgress())
    this.saveChange(this._state.getPendingChange());
  
  this._state = this._addState;
  this._state.init();
  this._state.add(val, at);
};
LocalChanges.prototype.handleSwitchToRemoveState = function(val, count){
  // Get any pending change to avoid data miss
  if(this._state.isChangeInProgress())
    this.saveChange(this._state.getPendingChange());

  this._state = this._removeState;
  this._state.init();
  this._state.remove(val, count);
};
LocalChanges.prototype.saveChange = function(change) {
  this._modifications.push(change);
};




function LocalChangeAddState(mem){
  this._mem = mem;
  this._startAddedPos = undefined;
  this._addedData = undefined;
}
LocalChangeAddState.prototype.add = function(at, val){
  // Set when cursor was not set before
  this._startAddedPos = this._startAddedPos || at;
  
  var theoricalAt = this._startAddedPos + this._addedData.length;
  if(theoricalAt != at && this._addedData.length != 0) {
    // change somewhere else... save 
    this._mem.saveChange(createAddModif(this._addedData, this._startAddedPos));

    // and start new change
    this._startAddedPos = at;
    this._addedData = val;
  }
  else {
    this._addedData += val;
  }
};
LocalChangeAddState.prototype.remove = function(at, count) { 
  this._mem.handleSwitchToRemoveState(at, count); 
};
LocalChangeAddState.prototype.init = function() {
  this._startAddedPos = undefined;
  this._addedData = "";
};
LocalChangeAddState.prototype.isChangeInProgress = function() {
  return this._addedData.length != 0;
};
LocalChangeAddState.prototype.getPendingChange = function() {
  return createAddModif(this._addedData, this._startAddedPos);
};
LocalChangeAddState.prototype.update = function(delta) {
  if(this._startAddedPos != undefined && delta.pos <= this._startAddedPos) {
    this._startAddedPos += delta.type == CHANGE_RM_TYPE ? 
      -delta.count : 
      delta.content.length;
  }
};





function LocalChangeRemoveState(mem){
  this._mem = mem;
  this._startRemovePos = undefined;
  this._removedCount = undefined;
}
LocalChangeRemoveState.prototype.add = function(at, val){
  this._mem.handleSwitchToAddState(at, val); 
};
LocalChangeRemoveState.prototype.remove = function(at, count) { 
  // Set when cursor was not set before
  // Needed because we don`t know here the size of the full text
  this._startRemovePos = this._startRemovePos || at;

  var theoricalAt = this._startRemovePos - this._removedCount;
  if(theoricalAt != at && this._removedCount != 0) {
    // change somewhere else... save 
    this._mem.saveChange(createRemoveModif(this._removedCount, this._startRemovePos));

    // and start new change
    this._startRemovePos = at;
    this._removedCount = count;
  }
  else {
    this._removedCount += count;
  }
};
LocalChangeRemoveState.prototype.init = function() {
  this._startRemovePos = undefined;
  this._removedCount = 0;
};
LocalChangeRemoveState.prototype.isChangeInProgress = function() {
  return this._removedCount != 0;
};
LocalChangeRemoveState.prototype.getPendingChange = function() {
  return createRemoveModif(this._removedCount, this._startRemovePos);
};
LocalChangeRemoveState.prototype.update = function(delta) {
  if(this._startRemovePos != undefined && delta.pos <= this._startRemovePos) {
    this._startRemovePos += delta.type == CHANGE_RM_TYPE ? 
      -delta.count : 
      delta.content.length;
  }
};


/* Class to encapsulate how communications are done.
This will allow to change only internal representation
easily when needed */
function RequestHandler(host, recvCallback) {

  // For closure
  var obj = this;

  this._hostws = "ws://"+ host +"/ide/ws";
  this._retryTimeout = null;
  this._socket = null;

  this._recv = recvCallback;
  this._emptyCallback = function(){};

  this.init = function() {
    this._connect();
  };

  this._connect = function() {
    this._socket = new WebSocket(this._hostws);
    this._socket.onopen = this._socket_onopen;
    this._socket.onmessage = this._socket_onmessage;
    this._socket.onclose = this._socket_onclose;
  };

  this._socket_onopen = function(){
    clearTimeout(obj._retryTimeout);
  };

  this._socket_onmessage = function(msg){
    var json_obj = $.parseJSON(msg.data);
    if('opCode' in json_obj) {
      // json_obj is in two parts ... opCode and data
      obj._recv(json_obj.opCode, json_obj.data);
    }
    else {
      // Send default opcode
      console.log("No opCode in ws request for content", json_obj);
      obj._recv(0, json_obj);
    }
  };

  this._socket_onclose = function(){
    clearTimeout(obj._retryTimeout);
    obj._retryTimeout = setTimeout(obj._connect, RETRY_CONNECT_TIMEOUT);
  };

  this._send = function(type, controller, requestData, successCallback, errorCallback) {
    successCallback = successCallback || this._emptyCallback;
    errorCallback = errorCallback || this._emptyCallback;

    $.ajax({
      type: type,
      url: controller,
      data: requestData,
      cache: false,
      contentType: 'application/json',
      dataType: "json",
      success: function(response, text) { 
        successCallback(response, text);
      },
      error: function(request, status, error) {  
        errorCallback(request, status, error);
      }
    });
  };

  // Send a POST ; data is in payload
  this.post = function(controller, data, successCallback, errorCallback) {
    this._send("POST", controller, JSON.stringify(data), successCallback, errorCallback);
  };

  // Send a PUT ; data is in payload
  this.put = function(controller, data, successCallback, errorCallback) {
    this._send("PUT", controller, JSON.stringify(data), successCallback, errorCallback);
  };

  // Send a GET ; data is in query string
  this.get = function(controller, data, successCallback, errorCallback) {
    this._send("GET", controller, $.param(data), successCallback, errorCallback);
  };
}


/* Class to encapsulate tree view representation 
of the project */
function ProjectTreeView() {
  this._ID_PREFIX = "tree-node";

  this.initRoot = function(treeID, rootNodeName){
    $("#"+treeID).append(
      $('<ul>').append(
        $('<li>').attr("class", "parent_li").append(
          $('<span>').attr("class", "tree-node-dir").on("click", this._dirClick).append(
            $('<i>').attr("class", "icon-folder-open")).append(
            rootNodeName)).append(
          $('<ul>').attr("id", this._ID_PREFIX+'/'))));
  };

  this.addNode = function(nodepath) {
    nodepath = this._setAbsolute(nodepath).trim();
    if(this._isDir(nodepath)){
      // Create directory
      var parts = nodepath.split("/");
      var parentDir = parts.slice(0, -2).join("/") + "/";
      // The size-1 is necessary empty, size-2 contains the name
      this._addDir(parts[parts.length-2]+"/", parentDir);
    }
    else {
      // Create file
      var parts = nodepath.split("/");
      var parentDir = parts.slice(0, -1).join("/") + "/";
      this._addFile(parts[parts.length-1], parentDir);
    }
  };

  this.removeNode = function(nodepath){
    nodepath = this._setAbsolute(nodepath).trim();
    if(nodepath == "/"){
      console.log("TRYING TO REMOVE ROOT FOLDER .... BAD ...");
      alert("TRYING TO REMOVE ROOT FOLDER .... BAD ...");
      return;
    }

    if(this._isDir(nodepath)) {
      // Remove element and children
      this._getDirNode(this._ID_PREFIX+nodepath).parent().remove();
    }
    else { // File
      this._getFileNode(this._ID_PREFIX+nodepath).remove();
    }
  };

  this._isDir = function(path) {
    return path.endsWith("/");
  };

  this._getFileNode = function(id) {
    // Workaround to allow slashes in selector
    return $("li[id='" + id + "']");
  };

  this._getDirNode = function(id) {
    // Workaround to allow slashes in selector
    return $("ul[id='" + id + "']");
  };

  this._setAbsolute = function(path){
    return path.startsWith("/") ? path : "/" + path;
  };

  this._addDir = function(dirname, parentDir){
    var parentId = this._ID_PREFIX + parentDir;
    var nodeId = parentId + dirname;

    if(this._getDirNode(nodeId).length != 0){
      alert("Node already exists : " + (parentDir + dirname));
      return;
    }

    this._getDirNode(parentId).append(
      $('<li>').attr("class", "parent_li")
               .append(
        $('<span>').attr("class", "tree-node-dir")
                   .on("click", this._dirClick)
                   .append($('<i>').attr("class", "icon-folder-open"))
                   .append(dirname))
               .append(
        $('<ul>').attr("id", nodeId)));
  };

  this._addFile = function(filename, parentDir) {
    var parentId = this._ID_PREFIX + parentDir;
    var nodeId = parentId + filename;

    if(this._getFileNode(nodeId).length != 0){
      alert("Node already exists : " + (parentDir + filename));
      return;
    }

    this._getDirNode(parentId).append(
      $('<li>').attr("class", "parent_li")
               .attr("id", nodeId)
               .append(
        $('<span>').attr("class", "tree-node-file")
                   .attr("title", parentDir+filename)
                   .on("click", this._fileClick)
                   .append($('<i>').attr("class", "icon-file"))
               .append(filename)));
  };

  this._fileClick = function(e) {
    // 'this' is now the treeview node element
    alert("TODO: Switch to file " + this.title);
    //communicator.showFileContent(this.title);
    e.stopPropagation();
  };

  this._dirClick = function(e) {
    // 'this' is now the treeview node element
    var children = $(this).parent('li.parent_li').find(' > ul > li');
    if (children.is(":visible")) {
        children.hide('fast');
        $(this).attr('title', 'Expand this branch').find(' > i').addClass('icon-plus-sign').removeClass('icon-minus-sign');
    } else {
        children.show('fast');
        $(this).attr('title', 'Collapse this branch').find(' > i').addClass('icon-minus-sign').removeClass('icon-plus-sign');
    }
    e.stopPropagation();
  };
}


// ##########################################
// #####                                #####
// #####         Representation         #####
// #####                                #####
// ##########################################

// used for /ide/save
function createModifGroup(changes, file, vers) { return { file: file, vers: vers, changes: changes}; }

function createAddModif(content, pos) { return { content: content, pos: pos, type: CHANGE_ADD_TYPE}; }
function createRemoveModif(count, pos) { return { count: count, pos: pos, type: CHANGE_RM_TYPE}; }

// used for /ide/open
function createOpen(filename) { return { file: filename}; }

// ###################################
// #####                         #####
// #####         Helpers         #####
// #####                         #####
// ###################################

/* SELECTION HELPER FUNCTIONS */
$.fn.selectRange = function(start, end) {
  // Check 'end' variable presence
  end = (end == undefined) ? start : end; 
  // Apply cursor to all given elements
  return this.each(function() {
    if (this.setSelectionRange) {
      this.focus();
      this.setSelectionRange(start, end);
    } else if (this.createTextRange) {
      var range = this.createTextRange();
      range.collapse(true);
      range.moveEnd('character', end);
      range.moveStart('character', start);
      range.select();
    }
  });
};

/* CURSOR HELPER FUNCTIONS */
$.fn.setCursorPosition = function(pos) { this.selectRange(pos, pos); };
$.fn.getCursorPosition = function() { return this.prop("selectionStart"); };

// getCaretCharacterOffsetWithin(document.getElementById("editorDisplay"));
function getCaretCharacterOffsetWithin(element) {
  var caretOffset = 0;
  var doc = element.ownerDocument || element.document;
  var win = doc.defaultView || doc.parentWindow;
  var sel;
  if (typeof win.getSelection != "undefined") {
    sel = win.getSelection();
    if (sel.rangeCount > 0) {
      var range = win.getSelection().getRangeAt(0);
      var preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(element);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      caretOffset = preCaretRange.toString().length;
    }
  } else if ( (sel = doc.selection) && sel.type != "Control") {
    var textRange = sel.createRange();
    var preCaretTextRange = doc.body.createTextRange();
    preCaretTextRange.moveToElementText(element);
    preCaretTextRange.setEndPoint("EndToEnd", textRange);
    caretOffset = preCaretTextRange.text.length;
  }
  return caretOffset;
}

/* ARRAY HELPER */
Array.prototype.dcopy = function() {
  return $.extend(true, [], this);
};
Array.prototype.clear = function() {
  while (this.length) {
    this.pop();
  }
};

/* STRING HELPER */
String.prototype.insert = function(str, index) {
  return this.slice(0, index) + str + this.slice(index);
};
String.prototype.startsWith = function (str) {
  return this.indexOf(str) == 0;
};
String.prototype.endsWith = function(str) {
  var d = this.length - str.length;
  var ends = d >= 0 && this.lastIndexOf(str) === d;
  return d >= 0 && this.lastIndexOf(str) === d;
};
String.prototype.cut = function(start, end) {
  return this.substr(0,start) + this.substr(end+1);
};

/* MEASUREMENT HELPER */
function sleep(milliseconds) {
  var start = new Date().getTime();
  for (var i = 0; i < 1e7; i++) {
    if ((new Date().getTime() - start) > milliseconds){
      break;
    }
  }
}
