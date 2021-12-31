'use strict';
$(function () {

	/*
	================================================================================
		Variables & Consts
	================================================================================
	*/

	// Dom Elements
	const progressBar = $('.progress-bar');
	const progressText = $('.progress-text');
	const stepText = $('.step-text');

	$.urlParam = function (name) {
		let results = new RegExp('[\?&]' + name + '=([^&#]*)')
			.exec(window.location.href);
		if (results == null) {
			return 0;
		}
		return results[1] || 0;
	};

	// Library
	const { remote } = require('electron');

	if ($.urlParam('version') !== "1") {
		remote.getCurrentWindow().show();
		progressText.text('');
		stepText.css({ color: 'red' });
		stepText.text('Vous devez retélécharger le launcher sur le site !');
		setTimeout(() => {
			remote.getCurrentWindow().close();
		}, 30000);
		return;
	}

	const path = require('path');
	const fs = require('fs');
	const crypto = require('crypto');
	const os = require('os');
	const request = require('request');
	const progress = require('request-progress');
	const { spawn, exec } = require('child_process');
	const decompress = require('decompress');

	// Temporary
	const uploadPath = getWorkingDirectory();
	let javaPath = 'java';

	if (!fs.existsSync(uploadPath)) {
		fs.mkdirSync(uploadPath);
	}

	/*
	================================================================================
		Form
	================================================================================
	*/

	function getWorkingDirectory() {
		let platform = os.platform();
		let home = os.homedir();
		let workingDirectory;
		switch (platform) {
			case 'win32':
				let applicationData = process.env.APPDATA;
				workingDirectory = path.join(applicationData ? applicationData : home, '.Erazion\\');
				break;
			case 'darwin':
				workingDirectory = path.join(home, 'Library/Application Support/Erazion/');
				break;
			case 'linux':
			case 'sunos':
				workingDirectory = path.join(home, '.Erazion/');
				break;
			default:
				workingDirectory = path.join(home, 'Erazion/');
		}
		return path.normalize(workingDirectory);
	}

	function getWindowsArch() {
		let useEnv = false;
		try {
			useEnv = !!(process.env.SYSTEMROOT && fs.statSync(process.env.SYSTEMROOT))
		} catch (err) {
		}

		let sysRoot = useEnv ? process.env.SYSTEMROOT : 'C:\\Windows';

		let isWOW64 = false;
		try {
			isWOW64 = !!fs.statSync(path.join(sysRoot, 'sysnative'));
		} catch (err) {
		}

		return isWOW64 ? '64' : '86'
	}

	function getArch() {
		let arch = os.arch();
		let result;
		switch (arch) {
			case 'arm64':
			case 'mipsel':
			case 'ppc64':
			case 's390x':
			case 'x64':
				result = '64';
				break;
			case 'arm':
			case 'ia32':
			case 'mips':
			case 'ppc':
			case 's390':
			case 'x32':
				result = '86';
				break;
			default:
				result = '86';
		}
		return result;
	}

	function getPlatform() {
		let platform = os.platform();
		let url;
		switch (platform) {
			case 'win32':
				url = 'windows_' + getWindowsArch();
				break;
			case 'darwin':
				url = 'macos';
				break;
			case 'linux':
			case 'sunos':
				url = 'linux_' + getArch();
				break;
			default:
				url = 'linux_' + getArch();
		}
		return url;
	}

	function download(url, path, cb) {
		console.log(url);
		progress(request(url), { throttle: 250 })
			.on('progress', function (state) {
				let percent = (state.percent * 100).toFixed(2);
				let message = percent + '% Téléchargé';
				progressText.text(message);
				progressBar.css({ width: percent + '%' });
			})
			.on('error', function (err) {
				cb(err);
			})
			.on('end', function () {
				progressText.text('0% Téléchargé');
				progressBar.css({ width: '0%' });
				cb(null);
			})
			.pipe(fs.createWriteStream(path));
	}

	function downloadLauncher(cb) {
		fs.unlink(uploadPath + 'launcher.jar', () => {
			download('http://launcher.erazion.net/minecraft/launcher.jar', uploadPath + 'launcher.jar', cb);
		});
	}

	function downloadJava(cb) {
		if (!fs.existsSync(uploadPath + 'java')) {
			fs.mkdirSync(uploadPath + 'java');
		}
		fs.unlink(uploadPath + 'java/jre.tar.gz', () => {
			download('http://launcher.erazion.net/java/jre_' + getPlatform() + '.tar.gz', uploadPath + 'java/jre.tar.gz', cb);
		});
	}

	function unzip(from, to, cb) {
		let percent = 0;
		let nextPercent = '...';
		let unziped = setInterval(() => {
			if (percent < 100) {
				percent += 10;
			}
			if (nextPercent === '...') {
				nextPercent = '';
			}
			nextPercent += '.';
			progressText.text('Unzip ' + nextPercent);
			progressBar.css({ width: percent * 100 / 100 + '%' });
		}, 500);
		decompress(from, to)
			.then(() => {
				clearInterval(unziped);
				progressBar.css({ width: 100 + '%' });
				cb(null);
			})
			.catch(error => {
				progressBar.css({ width: 100 + '%' });
				cb(error);
			});
	}

	let promises = [];
	promises.push(new Promise(resolve => {
		let launcher = $.urlParam('launcher');
		if (launcher) {
			let fd = fs.createReadStream(uploadPath + 'launcher.jar');
			let hash = crypto.createHash('md5');
			hash.setEncoding('hex');

			fd.on('error', () => {
				resolve(true);
			});

			fd.on('end', () => {
				hash.end();
				let md5 = hash.read();
				console.info('launcher md5: ' + launcher);
				console.info('local md5: ' + md5);
				resolve(launcher !== md5);
			});

			fd.pipe(hash);
		} else {
			resolve(true);
		}
	}));

	promises.push(new Promise(resolve => {
		let version = $.urlParam('java');
		if (true || !version) {
			version = '1.8.0_51';
		}
		if (fs.existsSync(uploadPath + 'java/version')) {
			javaPath = path.normalize(uploadPath + 'java/jre' + version + '/bin/java' + (os.platform() === 'win32' ? 'w.exe' : ''));
			fs.readFile(uploadPath + 'java/version', 'utf8', function (err, localVersion) {
				if (err) console.error(err);

				console.info('java version: ' + version);
				console.info('local java version: ' + localVersion);
				let download = version !== localVersion;
				if (!download) {
					download = !fs.existsSync(uploadPath + 'java/jre' + version + '/bin/java' + (os.platform() === 'win32' ? 'w.exe' : ''));
				}
				if (download) {
					try {
						fs.rmdir(uploadPath + 'java/jre' + localVersion, { recursive: true }, function(err1, test) {
							if (err1) console.error(err1);
						});
					} catch (err) {}
				}
				resolve(download ? version : false);
			});
		} else {
			resolve(version);
		}
	}));

	Promise.all(promises)
		.then(result => {
			let launcher = result[0] === true;
			let version = result[1];
			let java = version !== false;
			let promise = Promise.resolve();
			if (launcher || java) {
				remote.getCurrentWindow().show();
				let step = 0;
				let steps = 0;
				if (launcher) {
					steps += 1;
					promise = promise.then(() => {
						return new Promise(revolve => {
							step += 1;
							stepText.text(step + '/' + steps + ' Étapes');
							downloadLauncher(err => {
								if (err) console.error(err);
								revolve();
							})
						})
					});
				}
				if (java) {
					javaPath = path.normalize(uploadPath + 'java/jre' + version + '/bin/java' + (os.platform() === 'win32' ? 'w.exe' : ''));
					steps += 2;
					promise = promise.then(() => {
						return new Promise(resolve => {
							step += 1;
							stepText.text(step + '/' + steps + ' Étapes');
							downloadJava(err => {
								if (err) console.error(err);
								step += 1;
								stepText.text(step + '/' + steps + ' Étapes');
								unzip(uploadPath + 'java/jre.tar.gz', uploadPath + 'java/', err => {
									if (err) {
										console.error(err);
										javaPath = 'java';
									}
									let promises = [];
									promises.push(new Promise((resolve, reject) => {
										fs.writeFile(uploadPath + 'java/version', version, err => {
											if (err) return reject(err);
											resolve();
										});
									}));
									Promise.all(promises)
										.then(() => {
											fs.unlink(uploadPath + 'java/jre.tar.gz', err => {
												if (err) console.error(err);
											});
											resolve();
										})
										.catch(error => {
											console.error(error);
										})
								});
							})
						})
					});
				}
			}
			promise.then(() => {
				let thread = spawn(javaPath, ['-cp', uploadPath + 'launcher.jar', 'net.erazion.launcher.Launcher'], {
					detached: true
				});

				thread.stdout.on('data', () => {
					remote.getCurrentWindow().close();
				});

				thread.on('error', (err) => {
					remote.getCurrentWindow().show();
					console.error(err);
					progressText.text('');
					stepText.css({ color: 'red' });
					stepText.text(err);
					setTimeout(() => {
						remote.getCurrentWindow().close();
					}, 30000);
				});

				thread.unref();
			})
		})
		.catch(err => {
			console.error(err);
		})

});
