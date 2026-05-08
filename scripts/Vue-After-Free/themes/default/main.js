(function () {
  include('languages.js');
  log(lang.loadingMainMenu);
  var currentButton = 0;
  var buttons = [];
  var buttonTexts = [];
  var buttonMarkers = [];
  var buttonOrigPos = [];
  var textOrigPos = [];
  var normalButtonImg = 'file:///assets/img/button_over_9.png';
  var selectedButtonImg = 'file:///assets/img/button_over_9.png';
  jsmaf.root.children.length = 0;
  new Style({
    name: 'white',
    color: 'white',
    size: 24
  });
  new Style({
    name: 'title',
    color: 'white',
    size: 32
  });
  if (typeof startBgmIfEnabled === 'function') {
    startBgmIfEnabled();
  }
  var background = new Image({
    url: 'file:///../download0/img/multiview_bg_VAF.png',
    x: 0,
    y: 0,
    width: 1920,
    height: 1080
  });
  jsmaf.root.children.push(background);
  var centerX = 960;
  var logoWidth = 600;
  var logoHeight = 338;
  var logo = new Image({
    url: 'file:///../download0/img/logo.png',
    x: centerX - logoWidth / 2,
    y: 50,
    width: logoWidth,
    height: logoHeight
  });
  jsmaf.root.children.push(logo);
  var menuOptions = [{
    label: lang.jailbreak,
    script: 'loader.js',
    imgKey: 'jailbreak'
  }, {
    label: lang.payloadMenu,
    script: 'payload_host.js',
    imgKey: 'payloadMenu'
  }, {
    label: lang.config,
    script: 'config_ui.js',
    imgKey: 'config'
  }];
  var startY = 450;
  var buttonSpacing = 120;
  var buttonWidth = 400;
  var buttonHeight = 80;
  for (var i = 0; i < menuOptions.length; i++) {
    var btnX = centerX - buttonWidth / 2;
    var btnY = startY + i * buttonSpacing;
    var button = new Image({
      url: normalButtonImg,
      x: btnX,
      y: btnY,
      width: buttonWidth,
      height: buttonHeight
    });
    buttons.push(button);
    jsmaf.root.children.push(button);
    var marker = new Image({
      url: 'file:///assets/img/ad_pod_marker.png',
      x: btnX + buttonWidth - 50,
      y: btnY + 35,
      width: 12,
      height: 12,
      visible: false
    });
    buttonMarkers.push(marker);
    jsmaf.root.children.push(marker);
    var btnText = void 0;
    if (useImageText) {
      btnText = new Image({
        url: textImageBase + menuOptions[i].imgKey + '.png',
        x: btnX + 20,
        y: btnY + 15,
        width: 300,
        height: 50
      });
    } else {
      btnText = new jsmaf.Text();
      btnText.text = menuOptions[i].label;
      btnText.x = btnX + buttonWidth / 2 - 60;
      btnText.y = btnY + buttonHeight / 2 - 12;
      btnText.style = 'white';
    }
    buttonTexts.push(btnText);
    jsmaf.root.children.push(btnText);
    buttonOrigPos.push({
      x: btnX,
      y: btnY
    });
    textOrigPos.push({
      x: btnText.x,
      y: btnText.y
    });
  }
  var exitX = centerX - buttonWidth / 2;
  var exitY = startY + menuOptions.length * buttonSpacing + 100;
  var exitButton = new Image({
    url: normalButtonImg,
    x: exitX,
    y: exitY,
    width: buttonWidth,
    height: buttonHeight
  });
  buttons.push(exitButton);
  jsmaf.root.children.push(exitButton);
  var exitMarker = new Image({
    url: 'file:///assets/img/ad_pod_marker.png',
    x: exitX + buttonWidth - 50,
    y: exitY + 35,
    width: 12,
    height: 12,
    visible: false
  });
  buttonMarkers.push(exitMarker);
  jsmaf.root.children.push(exitMarker);
  var exitText;
  if (useImageText) {
    exitText = new Image({
      url: textImageBase + 'exit.png',
      x: exitX + 20,
      y: exitY + 15,
      width: 300,
      height: 50
    });
  } else {
    exitText = new jsmaf.Text();
    exitText.text = lang.exit;
    exitText.x = exitX + buttonWidth / 2 - 20;
    exitText.y = exitY + buttonHeight / 2 - 12;
    exitText.style = 'white';
  }
  buttonTexts.push(exitText);
  jsmaf.root.children.push(exitText);
  buttonOrigPos.push({
    x: exitX,
    y: exitY
  });
  textOrigPos.push({
    x: exitText.x,
    y: exitText.y
  });
  var zoomInInterval = null;
  var zoomOutInterval = null;
  var prevButton = -1;
  function easeInOut(t) {
    return (1 - Math.cos(t * Math.PI)) / 2;
  }
  function animateZoomIn(btn, text, btnOrigX, btnOrigY, textOrigX, textOrigY) {
    if (zoomInInterval) jsmaf.clearInterval(zoomInInterval);
    var btnW = buttonWidth;
    var btnH = buttonHeight;
    var startScale = btn.scaleX || 1.0;
    var endScale = 1.1;
    var duration = 175;
    var elapsed = 0;
    var step = 16;
    zoomInInterval = jsmaf.setInterval(function () {
      elapsed += step;
      var t = Math.min(elapsed / duration, 1);
      var eased = easeInOut(t);
      var scale = startScale + (endScale - startScale) * eased;
      btn.scaleX = scale;
      btn.scaleY = scale;
      btn.x = btnOrigX - btnW * (scale - 1) / 2;
      btn.y = btnOrigY - btnH * (scale - 1) / 2;
      text.scaleX = scale;
      text.scaleY = scale;
      text.x = textOrigX - btnW * (scale - 1) / 2;
      text.y = textOrigY - btnH * (scale - 1) / 2;
      if (t >= 1 && zoomInInterval) {
        jsmaf.clearInterval(zoomInInterval);
        zoomInInterval = null;
      }
    }, step);
  }
  function animateZoomOut(btn, text, btnOrigX, btnOrigY, textOrigX, textOrigY) {
    if (zoomOutInterval) jsmaf.clearInterval(zoomOutInterval);
    var btnW = buttonWidth;
    var btnH = buttonHeight;
    var startScale = btn.scaleX || 1.1;
    var endScale = 1.0;
    var duration = 175;
    var elapsed = 0;
    var step = 16;
    zoomOutInterval = jsmaf.setInterval(function () {
      elapsed += step;
      var t = Math.min(elapsed / duration, 1);
      var eased = easeInOut(t);
      var scale = startScale + (endScale - startScale) * eased;
      btn.scaleX = scale;
      btn.scaleY = scale;
      btn.x = btnOrigX - btnW * (scale - 1) / 2;
      btn.y = btnOrigY - btnH * (scale - 1) / 2;
      text.scaleX = scale;
      text.scaleY = scale;
      text.x = textOrigX - btnW * (scale - 1) / 2;
      text.y = textOrigY - btnH * (scale - 1) / 2;
      if (t >= 1 && zoomOutInterval) {
        jsmaf.clearInterval(zoomOutInterval);
        zoomOutInterval = null;
      }
    }, step);
  }
  function updateHighlight() {
    // Animate out the previous button
    var prevButtonObj = buttons[prevButton];
    var buttonMarker = buttonMarkers[prevButton];
    if (prevButton >= 0 && prevButton !== currentButton && prevButtonObj && buttonMarker) {
      prevButtonObj.url = normalButtonImg;
      prevButtonObj.alpha = 0.7;
      prevButtonObj.borderColor = 'transparent';
      prevButtonObj.borderWidth = 0;
      buttonMarker.visible = false;
      animateZoomOut(prevButtonObj, buttonTexts[prevButton], buttonOrigPos[prevButton].x, buttonOrigPos[prevButton].y, textOrigPos[prevButton].x, textOrigPos[prevButton].y);
    }

    // Set styles for all buttons
    for (var _i = 0; _i < buttons.length; _i++) {
      var _button = buttons[_i];
      var _buttonMarker = buttonMarkers[_i];
      var buttonText = buttonTexts[_i];
      var buttonOrigPos_ = buttonOrigPos[_i];
      var textOrigPos_ = textOrigPos[_i];
      if (_button === undefined || buttonText === undefined || buttonOrigPos_ === undefined || textOrigPos_ === undefined || _buttonMarker === undefined) continue;
      if (_i === currentButton) {
        _button.url = selectedButtonImg;
        _button.alpha = 1.0;
        _button.borderColor = 'rgb(100,180,255)';
        _button.borderWidth = 3;
        _buttonMarker.visible = true;
        animateZoomIn(_button, buttonText, buttonOrigPos_.x, buttonOrigPos_.y, textOrigPos_.x, textOrigPos_.y);
      } else if (_i !== prevButton) {
        _button.url = normalButtonImg;
        _button.alpha = 0.7;
        _button.borderColor = 'transparent';
        _button.borderWidth = 0;
        _button.scaleX = 1.0;
        _button.scaleY = 1.0;
        _button.x = buttonOrigPos_.x;
        _button.y = buttonOrigPos_.y;
        buttonText.scaleX = 1.0;
        buttonText.scaleY = 1.0;
        buttonText.x = textOrigPos_.x;
        buttonText.y = textOrigPos_.y;
        _buttonMarker.visible = false;
      }
    }
    prevButton = currentButton;
  }
  function handleButtonPress() {
    if (currentButton === buttons.length - 1) {
      include('includes/kill_vue.js');
    } else if (currentButton < menuOptions.length) {
      var selectedOption = menuOptions[currentButton];
      if (!selectedOption) return;
      if (selectedOption.script === 'loader.js') {
        jsmaf.onKeyDown = function () {};
      }
      log('Loading ' + selectedOption.script + '...');
      try {
        if (selectedOption.script.includes('loader.js')) {
          include(selectedOption.script);
        } else {
          include('themes/' + (typeof CONFIG !== 'undefined' && CONFIG.theme ? CONFIG.theme : 'default') + '/' + selectedOption.script);
        }
      } catch (e) {
        log('ERROR loading ' + selectedOption.script + ': ' + e.message);
        if (e.stack) log(e.stack);
      }
    }
  }
  jsmaf.onKeyDown = function (keyCode) {
    if (keyCode === 6 || keyCode === 5) {
      currentButton = (currentButton + 1) % buttons.length;
      updateHighlight();
    } else if (keyCode === 4 || keyCode === 7) {
      currentButton = (currentButton - 1 + buttons.length) % buttons.length;
      updateHighlight();
    } else if (keyCode === 14) {
      handleButtonPress();
    }
  };
  updateHighlight();
  log(lang.mainMenuLoaded);
})();