if (typeof libc_addr === 'undefined') {
  include('userland.js');
}
if (typeof lang === 'undefined') {
  include('languages.js');
}
(function () {
  log(lang.loadingConfig);
  var fs = {
    write: function (filename, content, callback) {
      var xhr = new jsmaf.XMLHttpRequest();
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && callback) {
          callback(xhr.status === 0 || xhr.status === 200 ? null : new Error('failed'));
        }
      };
      xhr.open('POST', 'file://../download0/' + filename, true);
      xhr.send(content);
    },
    read: function (filename, callback) {
      var xhr = new jsmaf.XMLHttpRequest();
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && callback) {
          callback(xhr.status === 0 || xhr.status === 200 ? null : new Error('failed'), xhr.responseText);
        }
      };
      xhr.open('GET', 'file://../download0/' + filename, true);
      xhr.send();
    }
  };
  var currentConfig = {
    autolapse: false,
    autopoop: false,
    autoclose: false,
    autoclose_delay: 0,
    music: true,
    jb_behavior: 0,
    theme: 'default'
  };

  // Store user's payloads so we don't overwrite them
  var userPayloads = [];
  var configLoaded = false;
  var jbBehaviorLabels = [lang.jbBehaviorAuto, lang.jbBehaviorNetctrl, lang.jbBehaviorLapse];
  var jbBehaviorImgKeys = ['jbBehaviorAuto', 'jbBehaviorNetctrl', 'jbBehaviorLapse'];
  function scanThemes() {
    var themes = [];
    try {
      fn.register(0x05, 'open_sys', ['bigint', 'bigint', 'bigint'], 'bigint');
      fn.register(0x06, 'close_sys', ['bigint'], 'bigint');
      fn.register(0x110, 'getdents', ['bigint', 'bigint', 'bigint'], 'bigint');
      var themesDir = '/download0/themes';
      var path_addr = mem.malloc(256);
      var buf = mem.malloc(4096);
      for (var i = 0; i < themesDir.length; i++) {
        mem.view(path_addr).setUint8(i, themesDir.charCodeAt(i));
      }
      mem.view(path_addr).setUint8(themesDir.length, 0);
      var fd = fn.open_sys(path_addr, new BigInt(0, 0), new BigInt(0, 0));
      if (!fd.eq(new BigInt(0xffffffff, 0xffffffff))) {
        var count = fn.getdents(fd, buf, new BigInt(0, 4096));
        if (!count.eq(new BigInt(0xffffffff, 0xffffffff)) && count.lo > 0) {
          var offset = 0;
          while (offset < count.lo) {
            var d_reclen = mem.view(buf.add(new BigInt(0, offset + 4))).getUint16(0, true);
            var d_type = mem.view(buf.add(new BigInt(0, offset + 6))).getUint8(0);
            var d_namlen = mem.view(buf.add(new BigInt(0, offset + 7))).getUint8(0);
            var name = '';
            for (var _i = 0; _i < d_namlen; _i++) {
              name += String.fromCharCode(mem.view(buf.add(new BigInt(0, offset + 8 + _i))).getUint8(0));
            }
            if (d_type === 4 && name !== '.' && name !== '..') {
              themes.push(name);
            }
            offset += d_reclen;
          }
        }
        fn.close_sys(fd);
      }
    } catch (e) {
      log('Theme scan failed: ' + e.message);
    }
    var idx = themes.indexOf('default');
    if (idx > 0) {
      themes.splice(idx, 1);
      themes.unshift('default');
    } else if (idx < 0) {
      themes.unshift('default');
    }
    return themes;
  }
  var availableThemes = scanThemes();
  log('Discovered themes: ' + availableThemes.join(', '));
  var themeLabels = availableThemes.map(theme => theme.charAt(0).toUpperCase() + theme.slice(1));
  var themeImgKeys = availableThemes.map(theme => 'theme' + theme.charAt(0).toUpperCase() + theme.slice(1));
  var currentButton = 0;
  var buttons = [];
  var buttonTexts = [];
  var buttonMarkers = [];
  var buttonOrigPos = [];
  var textOrigPos = [];
  var valueTexts = [];
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
  var background = new Image({
    url: 'file:///../download0/img/multiview_bg_VAF.png',
    x: 0,
    y: 0,
    width: 1920,
    height: 1080
  });
  jsmaf.root.children.push(background);
  var logo = new Image({
    url: 'file:///../download0/img/logo.png',
    x: 1620,
    y: 0,
    width: 300,
    height: 169
  });
  jsmaf.root.children.push(logo);
  if (useImageText) {
    var title = new Image({
      url: textImageBase + 'config.png',
      x: 860,
      y: 100,
      width: 200,
      height: 60
    });
    jsmaf.root.children.push(title);
  } else {
    var _title = new jsmaf.Text();
    _title.text = lang.config;
    _title.x = 910;
    _title.y = 120;
    _title.style = 'title';
    jsmaf.root.children.push(_title);
  }
  var configOptions = [{
    key: 'autolapse',
    label: lang.autoLapse,
    imgKey: 'autoLapse',
    type: 'toggle'
  }, {
    key: 'autopoop',
    label: lang.autoPoop,
    imgKey: 'autoPoop',
    type: 'toggle'
  }, {
    key: 'autoclose',
    label: lang.autoClose,
    imgKey: 'autoClose',
    type: 'toggle'
  }, {
    key: 'music',
    label: lang.music,
    imgKey: 'music',
    type: 'toggle'
  }, {
    key: 'jb_behavior',
    label: lang.jbBehavior,
    imgKey: 'jbBehavior',
    type: 'cycle'
  }, {
    key: 'theme',
    label: lang.theme || 'Theme',
    imgKey: 'theme',
    type: 'cycle'
  }];
  var centerX = 960;
  var startY = 200;
  var buttonSpacing = 120;
  var buttonWidth = 400;
  var buttonHeight = 80;
  for (var i = 0; i < configOptions.length; i++) {
    var configOption = configOptions[i];
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
    buttonMarkers.push(null);
    var btnText = void 0;
    if (useImageText) {
      btnText = new Image({
        url: textImageBase + configOption.imgKey + '.png',
        x: btnX + 20,
        y: btnY + 15,
        width: 200,
        height: 50
      });
    } else {
      btnText = new jsmaf.Text();
      btnText.text = configOption.label;
      btnText.x = btnX + 30;
      btnText.y = btnY + 28;
      btnText.style = 'white';
    }
    buttonTexts.push(btnText);
    jsmaf.root.children.push(btnText);
    if (configOption.type === 'toggle') {
      var checkmark = new Image({
        url: currentConfig[configOption.key] ? 'file:///assets/img/check_small_on.png' : 'file:///assets/img/check_small_off.png',
        x: btnX + 320,
        y: btnY + 20,
        width: 40,
        height: 40
      });
      valueTexts.push(checkmark);
      jsmaf.root.children.push(checkmark);
    } else {
      var valueLabel = void 0;
      if (configOption.key === 'jb_behavior') {
        if (useImageText) {
          valueLabel = new Image({
            url: textImageBase + jbBehaviorImgKeys[currentConfig.jb_behavior] + '.png',
            x: btnX + 230,
            y: btnY + 15,
            width: 150,
            height: 50
          });
        } else {
          valueLabel = new jsmaf.Text();
          valueLabel.text = jbBehaviorLabels[currentConfig.jb_behavior] || jbBehaviorLabels[0];
          valueLabel.x = btnX + 250;
          valueLabel.y = btnY + 28;
          valueLabel.style = 'white';
        }
      } else if (configOption.key === 'theme') {
        var themeIndex = availableThemes.indexOf(currentConfig.theme);
        var displayIndex = themeIndex >= 0 ? themeIndex : 0;
        if (useImageText) {
          valueLabel = new Image({
            url: textImageBase + themeImgKeys[displayIndex] + '.png',
            x: btnX + 230,
            y: btnY + 15,
            width: 150,
            height: 50
          });
        } else {
          valueLabel = new jsmaf.Text();
          valueLabel.text = themeLabels[displayIndex] || themeLabels[0];
          valueLabel.x = btnX + 250;
          valueLabel.y = btnY + 28;
          valueLabel.style = 'white';
        }
      }
      valueTexts.push(valueLabel);
      jsmaf.root.children.push(valueLabel);
    }
    buttonOrigPos.push({
      x: btnX,
      y: btnY
    });
    textOrigPos.push({
      x: btnText.x,
      y: btnText.y
    });
  }
  var backHint = new jsmaf.Text();
  backHint.text = jsmaf.circleIsAdvanceButton ? 'X to go back' : 'O to go back';
  backHint.x = centerX - 60;
  backHint.y = startY + configOptions.length * buttonSpacing + 120;
  backHint.style = 'white';
  jsmaf.root.children.push(backHint);
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
      if (t >= 1) {
        jsmaf.clearInterval(zoomInInterval !== null && zoomInInterval !== void 0 ? zoomInInterval : -1);
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
      if (t >= 1) {
        jsmaf.clearInterval(zoomOutInterval !== null && zoomOutInterval !== void 0 ? zoomOutInterval : -1);
        zoomOutInterval = null;
      }
    }, step);
  }
  function updateHighlight() {
    // Animate out the previous button
    var prevButtonObj = buttons[prevButton];
    var buttonMarker = buttonMarkers[prevButton];
    if (prevButton >= 0 && prevButton !== currentButton && prevButtonObj) {
      prevButtonObj.url = normalButtonImg;
      prevButtonObj.alpha = 0.7;
      prevButtonObj.borderColor = 'transparent';
      prevButtonObj.borderWidth = 0;
      if (buttonMarker) buttonMarker.visible = false;
      animateZoomOut(prevButtonObj, buttonTexts[prevButton], buttonOrigPos[prevButton].x, buttonOrigPos[prevButton].y, textOrigPos[prevButton].x, textOrigPos[prevButton].y);
    }

    // Set styles for all buttons
    for (var _i2 = 0; _i2 < buttons.length; _i2++) {
      var _button = buttons[_i2];
      var _buttonMarker = buttonMarkers[_i2];
      var buttonText = buttonTexts[_i2];
      var buttonOrigPos_ = buttonOrigPos[_i2];
      var textOrigPos_ = textOrigPos[_i2];
      if (_button === undefined || buttonText === undefined || buttonOrigPos_ === undefined || textOrigPos_ === undefined) continue;
      if (_i2 === currentButton) {
        _button.url = selectedButtonImg;
        _button.alpha = 1.0;
        _button.borderColor = 'rgb(100,180,255)';
        _button.borderWidth = 3;
        if (_buttonMarker) _buttonMarker.visible = true;
        animateZoomIn(_button, buttonText, buttonOrigPos_.x, buttonOrigPos_.y, textOrigPos_.x, textOrigPos_.y);
      } else if (_i2 !== prevButton) {
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
        if (_buttonMarker) _buttonMarker.visible = false;
      }
    }
    prevButton = currentButton;
  }
  function updateValueText(index) {
    var options = configOptions[index];
    var valueText = valueTexts[index];
    if (!options || !valueText) return;
    var key = options.key;
    if (options.type === 'toggle') {
      var value = currentConfig[key];
      valueText.url = value ? 'file:///assets/img/check_small_on.png' : 'file:///assets/img/check_small_off.png';
    } else {
      if (key === 'jb_behavior') {
        if (useImageText) {
          valueText.url = textImageBase + jbBehaviorImgKeys[currentConfig.jb_behavior] + '.png';
        } else {
          valueText.text = jbBehaviorLabels[currentConfig.jb_behavior] || jbBehaviorLabels[0];
        }
      } else if (key === 'theme') {
        var _themeIndex = availableThemes.indexOf(currentConfig.theme);
        var _displayIndex = _themeIndex >= 0 ? _themeIndex : 0;
        if (useImageText) {
          valueText.url = textImageBase + themeImgKeys[_displayIndex] + '.png';
        } else {
          valueText.text = themeLabels[_displayIndex] || themeLabels[0];
        }
      }
    }
  }
  function saveConfig() {
    if (!configLoaded) {
      log('Config not loaded yet, skipping save');
      return;
    }
    var configData = {
      config: {
        autolapse: currentConfig.autolapse,
        autopoop: currentConfig.autopoop,
        autoclose: currentConfig.autoclose,
        autoclose_delay: currentConfig.autoclose_delay,
        music: currentConfig.music,
        jb_behavior: currentConfig.jb_behavior,
        theme: currentConfig.theme
      },
      payloads: userPayloads
    };
    var configContent = JSON.stringify(configData, null, 2);
    fs.write('config.json', configContent, function (err) {
      if (err) {
        log('ERROR: Failed to save config: ' + err.message);
      } else {
        log('Config saved successfully');
      }
    });
  }
  function loadConfig() {
    fs.read('config.json', function (err, data) {
      if (err) {
        log('ERROR: Failed to read config: ' + err.message);
        return;
      }
      try {
        var configData = JSON.parse(data || '{}');
        if (configData.config) {
          var _CONFIG = configData.config;
          currentConfig.autolapse = _CONFIG.autolapse || false;
          currentConfig.autopoop = _CONFIG.autopoop || false;
          currentConfig.autoclose = _CONFIG.autoclose || false;
          currentConfig.autoclose_delay = _CONFIG.autoclose_delay || 0;
          currentConfig.music = _CONFIG.music !== false;
          currentConfig.jb_behavior = _CONFIG.jb_behavior || 0;

          // Validate and set theme (themes are auto-discovered from directory scan)
          if (_CONFIG.theme && availableThemes.includes(_CONFIG.theme)) {
            currentConfig.theme = _CONFIG.theme;
          } else {
            log('WARNING: Theme "' + (_CONFIG.theme || 'undefined') + '" not found in available themes, using default');
            currentConfig.theme = availableThemes[0] || 'default';
          }

          // Preserve user's payloads
          if (configData.payloads && Array.isArray(configData.payloads)) {
            userPayloads = configData.payloads.slice();
          }
          for (var _i3 = 0; _i3 < configOptions.length; _i3++) {
            updateValueText(_i3);
          }
          if (currentConfig.music) {
            startBgmIfEnabled();
          } else {
            stopBgm();
          }
          configLoaded = true;
          log('Config loaded successfully');
        }
      } catch (e) {
        log('ERROR: Failed to parse config: ' + e.message);
        configLoaded = true; // Allow saving even on error
      }
    });
  }
  function handleButtonPress() {
    if (currentButton < configOptions.length) {
      var option = configOptions[currentButton];
      var key = option.key;
      if (option.type === 'cycle') {
        if (key === 'jb_behavior') {
          currentConfig.jb_behavior = (currentConfig.jb_behavior + 1) % jbBehaviorLabels.length;
          log(key + ' = ' + jbBehaviorLabels[currentConfig.jb_behavior]);
        } else if (key === 'theme') {
          var _themeIndex2 = availableThemes.indexOf(currentConfig.theme);
          var _displayIndex2 = _themeIndex2 >= 0 ? _themeIndex2 : 0;
          var nextIndex = (_displayIndex2 + 1) % availableThemes.length;
          currentConfig.theme = availableThemes[nextIndex];
          log(key + ' = ' + currentConfig.theme);
        }
      } else {
        var boolKey = key;
        currentConfig[boolKey] = !currentConfig[boolKey];
        if (boolKey === 'music') {
          if (typeof CONFIG !== 'undefined') {
            CONFIG.music = currentConfig.music;
          }
          if (currentConfig.music) {
            startBgmIfEnabled();
          } else {
            stopBgm();
          }
        }
        if (key === 'autolapse' && currentConfig.autolapse === true) {
          currentConfig.autopoop = false;
          for (var _i4 = 0; _i4 < configOptions.length; _i4++) {
            if (configOptions[_i4].key === 'autopoop') {
              updateValueText(_i4);
              break;
            }
          }
          log('autopoop disabled (autolapse enabled)');
        } else if (key === 'autopoop' && currentConfig.autopoop === true) {
          currentConfig.autolapse = false;
          for (var _i5 = 0; _i5 < configOptions.length; _i5++) {
            if (configOptions[_i5].key === 'autolapse') {
              updateValueText(_i5);
              break;
            }
          }
          log('autolapse disabled (autopoop enabled)');
        }
        log(key + ' = ' + currentConfig[boolKey]);
      }
      updateValueText(currentButton);
      saveConfig();
    }
  }
  var confirmKey = jsmaf.circleIsAdvanceButton ? 13 : 14;
  var backKey = jsmaf.circleIsAdvanceButton ? 14 : 13;
  jsmaf.onKeyDown = function (keyCode) {
    if (keyCode === 6 || keyCode === 5) {
      currentButton = (currentButton + 1) % buttons.length;
      updateHighlight();
    } else if (keyCode === 4 || keyCode === 7) {
      currentButton = (currentButton - 1 + buttons.length) % buttons.length;
      updateHighlight();
    } else if (keyCode === confirmKey) {
      handleButtonPress();
    } else if (keyCode === backKey) {
      log('Restarting...');
      // Save config before restart
      saveConfig();
      jsmaf.setTimeout(function () {
        debugging.restart();
      }, 100);
    }
  };
  updateHighlight();
  loadConfig();
  log(lang.configLoaded);
})();