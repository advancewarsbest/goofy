const electron = require('electron');
const { 
	BrowserWindow, 
	autoUpdater, 
	dialog, 
	Notification,
	app,
	session, 
	ipcMain, 
	nativeImage,
} = electron;
const path = require('path');
const url = require('url');
const env = require('./config/env.js');
const constants = require('./helpers/constants');
const menubar = require('menubar');
const userConfig = require('./modules/userConfig');
const getMenuBarIconPath = require('./helpers/getMenuBarIconPath');
const RequestFilter = require('./modules/requestFilter');

app.setName(env.appName);
app.disableHardwareAcceleration();

// menubar widget only available for Workplace right now
const menubarEnabled = env.product === constants.PRODUCT_WORKPLACE && userConfig.get('menubar');
if (menubarEnabled) {
	global.sharedObject = {
		unread: 0,
		mb: menubar({
			index: 'file:///' + path.join(__dirname, 'menu.html'),
			icon: getMenuBarIconPath(),
			width: 300,
			preloadWindow: true,
			transparent: true,
			showDockIcon: true,
		}),
	};

	global.sharedObject.mb.on('show', () => {
		global.sharedObject.mb.tray.setImage(getMenuBarIconPath(true, global.sharedObject.unread));
	});
	global.sharedObject.mb.on('hide', () => {
		global.sharedObject.mb.tray.setImage(getMenuBarIconPath(false, global.sharedObject.unread));
	});
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let willQuitApp = false;

function createWindow() {
	const title = env.product === constants.PRODUCT_WORKPLACE ? 'Goofy at Work' : 'Goofy';

	// Open the app at the same screen position and size as last time, if possible
	let options = { 
		width: 800, 
		height: 600, 
		titleBarStyle: 'hiddenInset', 
		title, 
		webPreferences: {
			nodeIntegration: true,
		},
	};
	const previousLayout = userConfig.get('windowLayout');
	// BUG: Electron issue?
	// The docs (https://github.com/electron/electron/blob/master/docs/api/screen.md)
	// say electron.screen should be available after the ready event has fired, but
	// sometimes it's null
	if (electron.screen) {
		const displaySize = electron.screen.getPrimaryDisplay().workAreaSize;
		const screenWidth = displaySize.width;
		const screenHeight = displaySize.height;
		if (previousLayout) {
			// Would the window fit on the screen with the previous layout?
			if (
				previousLayout.width + previousLayout.x < screenWidth && previousLayout.height + previousLayout.y < screenHeight
			) {
				options.width = previousLayout.width;
				options.height = previousLayout.height;
				options.x = previousLayout.x;
				options.y = previousLayout.y;
			}
		}
	}

	// Create the browser window.
	mainWindow = new BrowserWindow(options);
	
	// Propagate retina resolution to requests if necessary
	const requestFilter = new RequestFilter(session);
	const display = electron.screen.getPrimaryDisplay();
	const scaleFactor = display.scaleFactor;
	if (scaleFactor !== 1.0) {
		requestFilter.setRetinaCookie(scaleFactor);
	}

	// and load the index.html of the app.
	mainWindow.loadURL(
		url.format({
			pathname: path.join(__dirname, 'index.html'),
			protocol: 'file:',
			slashes: true,
		})
	);

	mainWindow.on('close', e => {
		if (willQuitApp) {
			// Store the main window's layout before quitting
			const [ width, height ] = mainWindow.getSize();
			const [ x, y ] = mainWindow.getPosition();
			const currentLayout = { width, height, x, y };
			userConfig.set('windowLayout', currentLayout);

			// the user tried to quit the app
			mainWindow = null;
		} else {
			// the user only tried to close the window
			e.preventDefault();
			if (mainWindow) {
				if (!mainWindow.isFullScreen()) {
					mainWindow.hide();
					return;
				}
				mainWindow.setFullScreen(false);
				// Wait for full screen animation to finish before hiding
				setTimeout(
					() => {
						mainWindow.hide();
					},
					1000
				);
			}
		}
	});
}

ipcMain.on(constants.NEW_MESSAGE_NOTIFICATION, (event, params) => {
	const notifParams = params.notifParams;
	notifParams.icon = nativeImage.createFromDataURL(params.iconDataUrl);
	let notification = new Notification(notifParams);
	notification.on('click', () => {
		if (mainWindow) {
			mainWindow.show();
		}
		event.sender.send(constants.JUMP_TO_CONVERATION_BY_IMAGE_NAME, params.imageName);
	});
	notification.show();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

app.on('before-quit', () => willQuitApp = true);

// Quit when all windows are closed.
app.on('window-all-closed', function() {
	// On OS X it is common for applications and their menu bar
	// to stay active until the user quits explicitly with Cmd + Q
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', function() {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (mainWindow) {
		mainWindow.show();
	} else {
		createWindow();
	}
});

autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
	dialog.showMessageBox(
		{
			type: 'info',
			title: 'Update available',
			message: `A new version of ${env.appName} is available!`,
			detail: `${env.appName} ${releaseName} is now available—you have ${app.getVersion()}.  Restart the application to apply updates.`,
			buttons: [ 'Restart', 'Later' ],
		},
		(response) => {
			if (response === 0) {
				willQuitApp = true;
				autoUpdater.quitAndInstall();
			}
		}
	);
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

if (env.name === 'production') {
	autoUpdater.setFeedURL(`${env.updateURL}/${process.platform}-${process.arch}/${app.getVersion()}`);
	autoUpdater.checkForUpdates();
}
