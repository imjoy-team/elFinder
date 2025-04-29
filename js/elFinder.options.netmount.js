/**
 * Default elFinder config of commandsOptions.netmount
 *
 * @type  Object
 */

elFinder.prototype._options.commandsOptions.netmount = {
	hyphafs: {
		name: 'Hypha',
		inputs: {
			host  : $('<input type="text" placeholder="https://hypha.aicell.io/ws-user-anonymouz-flossy-spoonbill-28623986/services/KobNLFfoSN7zZEN8Yr7LU7:async-file-service" value="https://hypha.aicell.io/ws-user-anonymouz-flossy-spoonbill-28623986/services/KobNLFfoSN7zZEN8Yr7LU7:async-file-service"/>')
		}
	},
	hypha_artifacts: {
		name: 'Hypha Artifacts',
		inputs: {
			host  : $('<input type="text" placeholder="https://hypha.aicell.io/bioimage-io/artifacts/bioimage.io" value=""/>')
		}
	},
	s3: {
		name : 'S3',
		inputs: {
			host     : $('<input type="text" placeholder="s3://" value=""/>'),
			prefix    : $('<input type="text" value="" class="elfinder-input-optional"/>')
		}
	},
	ftp: {
		name : 'FTP',
		inputs: {
			host     : $('<input type="text"/>'),
			port     : $('<input type="number" placeholder="21" class="elfinder-input-optional"/>'),
			path     : $('<input type="text" value="/"/>'),
			user     : $('<input type="text"/>'),
			pass     : $('<input type="password" autocomplete="new-password"/>'),
			FTPS     : $('<input type="checkbox" value="1" title="File Transfer Protocol over SSL/TLS"/>'),
			encoding : $('<input type="text" placeholder="Optional" class="elfinder-input-optional"/>'),
			locale   : $('<input type="text" placeholder="Optional" class="elfinder-input-optional"/>')
		}
	},
	dropbox2: elFinder.prototype.makeNetmountOptionOauth('dropbox2', 'Dropbox', 'Dropbox', {noOffline : true,
		root : '/',
		pathI18n : 'path',
		integrate : {
			title: 'Dropbox.com',
			link: 'https://www.dropbox.com'
		}
	}),
	googledrive: elFinder.prototype.makeNetmountOptionOauth('googledrive', 'Google Drive', 'Google', {
		integrate : {
			title: 'Google Drive',
			link: 'https://www.google.com/drive/'
		}
	}),
	onedrive: elFinder.prototype.makeNetmountOptionOauth('onedrive', 'One Drive', 'OneDrive', {
		integrate : {
			title: 'Microsoft OneDrive',
			link: 'https://onedrive.live.com'
		}
	}),
	box: elFinder.prototype.makeNetmountOptionOauth('box', 'Box', 'Box', {
		noOffline : true,
		integrate : {
			title: 'Box.com',
			link: 'https://www.box.com'
		}
	})
};
