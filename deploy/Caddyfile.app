{
	admin off
	auto_https off
	persist_config off
}

:8080 {
	root * /srv
	encode zstd gzip
	header {
		-Server
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		X-Frame-Options DENY
		Cross-Origin-Opener-Policy same-origin-allow-popups
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		Cache-Control no-cache
		Content-Security-Policy "default-src 'self'; script-src 'self' https://www.gstatic.com https://apis.google.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.googleusercontent.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://*.firebaseapp.com https://www.gstatic.com; frame-src https://*.firebaseapp.com https://accounts.google.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
	}
	@private path /.env /.env.* /.git/* /scripts/* /deploy/* /database.rules.json /docker-compose.yml
	respond @private 404
	file_server
}
