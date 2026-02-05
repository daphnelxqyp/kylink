root@iZj6cj6h20j6kz2vmuzviqZ:/opt/kylink# journalctl -u kylink -n 200 --no-pager
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All IP check services failed - proxy may be unreachable or authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Diagnostic: username=bru30036_area-UNITED..., password=***
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Failed to get exit IP for ipip, will try without IP check
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All proxies failed IP check, trying fallback mode with connectivity test...
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: kookeey (priority=0, host=gate.kookeey.info:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: 4197658-8c0cae65-{COUNTRY}-session-{session:8}-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: 4197658-8c0cae65-UNITED STATES-session-27433202-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***2129
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for kookeey
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: 4197658-8c0cae65-UNITED STATES-session-27433202-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] ipinfo.io failed: request to https://ipinfo.io/json failed, reason: Client network socket disconnected before secure TLS connection was established
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] ipleak.net failed: request to https://ipleak.net/json/ failed, reason: Client network socket disconnected before secure TLS connection was established
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All IP check services failed - proxy may be unreachable or authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Diagnostic: username=bru30036_area-UNITED..., password=***
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Failed to get exit IP for ipip, will try without IP check
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All proxies failed IP check, trying fallback mode with connectivity test...
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: kookeey (priority=0, host=gate.kookeey.info:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: 4197658-8c0cae65-{COUNTRY}-session-{session:8}-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: 4197658-8c0cae65-UNITED STATES-session-91713316-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***2129
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for kookeey
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: 4197658-8c0cae65-UNITED STATES-session-91713316-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: koo2 connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: ipip (priority=3, host=sp.ipipbright.net:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: bru30036_area-{COUNTRY}_life-5_session-{random:10}
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: bru30036_area-UNITED STATES_life-5_session-khgp3c99ib
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***lth6
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for ipip
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: bru30036_area-UNITED STATES_life-5_session-khgp3c99ib
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] httpbin.org failed: request to http://httpbin.org/ip failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] ipleak.net failed: request to https://ipleak.net/json/ failed, reason: write EPROTO C04CEEA50F7F0000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:../deps/openssl/openssl/ssl/record/ssl3_record.c:354:
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23465044032: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] ipinfo.io failed: request to https://ipinfo.io/json failed, reason: Client network socket disconnected before secure TLS connection was established
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All IP check services failed - proxy may be unreachable or authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Diagnostic: username=bru30036_area-UNITED..., password=***
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Failed to get exit IP for ipip, will try without IP check
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All proxies failed IP check, trying fallback mode with connectivity test...
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: kookeey (priority=0, host=gate.kookeey.info:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: 4197658-8c0cae65-{COUNTRY}-session-{session:8}-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: 4197658-8c0cae65-UNITED STATES-session-34437529-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***2129
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for kookeey
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: 4197658-8c0cae65-UNITED STATES-session-34437529-life-5m
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23465044032: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23464896237: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23464896237: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: kookeey connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: koo2 (priority=1, host=gate.kookeey.info:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: 4197658-8c0cae65-session-{session:8}-life-5m-{COUNTRY}
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: 4197658-8c0cae65-session-62770440-life-5m-UNITED STATES
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***2129
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for koo2
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: 4197658-8c0cae65-session-62770440-life-5m-UNITED STATES
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23464896237: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23465044032: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped 8 items due to generation failures or proxy issues (production mode)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Generated 0 items in 493ms (0ms/item avg)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: kookeey connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: koo2 (priority=1, host=gate.kookeey.info:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: 4197658-8c0cae65-session-{session:8}-life-5m-{COUNTRY}
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: 4197658-8c0cae65-session-99306457-life-5m-UNITED STATES
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***2129
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for koo2
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: 4197658-8c0cae65-session-99306457-life-5m-UNITED STATES
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [DynamicWatermark] 23313525585: consumed24h=3, avgPerHour=0.13, watermark=3
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23464896237: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [DynamicWatermark] 23465201979: consumed24h=7, avgPerHour=0.29, watermark=3
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23464896237: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped 10 items due to generation failures or proxy issues (production mode)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Generated 0 items in 478ms (0ms/item avg)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: kookeey connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: koo2 (priority=1, host=gate.kookeey.info:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: 4197658-8c0cae65-session-{session:8}-life-5m-{COUNTRY}
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: 4197658-8c0cae65-session-79525196-life-5m-UNITED STATES
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***2129
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for koo2
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: 4197658-8c0cae65-session-79525196-life-5m-UNITED STATES
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [DynamicWatermark] 23151309598: consumed24h=6, avgPerHour=0.25, watermark=3
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [DynamicWatermark] 23367534125: No consumption history, using default watermark 5
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: koo2 connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: ipip (priority=3, host=sp.ipipbright.net:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: bru30036_area-{COUNTRY}_life-5_session-{random:10}
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: bru30036_area-UNITED STATES_life-5_session-p72brogmbj
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***lth6
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for ipip
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: bru30036_area-UNITED STATES_life-5_session-p72brogmbj
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: koo2 connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: ipip (priority=3, host=sp.ipipbright.net:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: bru30036_area-{COUNTRY}_life-5_session-{random:10}
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: bru30036_area-UNITED STATES_life-5_session-8w2tzvfle8
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***lth6
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for ipip
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: bru30036_area-UNITED STATES_life-5_session-8w2tzvfle8
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Socks5 Authentication failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: koo2 connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Trying proxy: ipip (priority=3, host=sp.ipipbright.net:1000)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Template: bru30036_area-{COUNTRY}_life-5_session-{random:10}
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Country: United States → Username: bru30036_area-UNITED STATES_life-5_session-7zhguxygml
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector]   Password: ***lth6
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: testing connectivity for ipip
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test with username: bru30036_area-UNITED STATES_life-5_session-7zhguxygml
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23404910351: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23404910351: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.baidu.com/robots.txt: request to http://www.baidu.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://www.google.com/robots.txt: request to http://www.google.com/robots.txt failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Connectivity test failed for http://httpbin.org/status/200: request to http://httpbin.org/status/200 failed, reason: Parse Error: Missing expected CR after response line
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] All connectivity tests failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [proxy-selector] Fallback: ipip connectivity test failed
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [suffix-generator] All proxies exhausted and mock suffix is disabled
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped suffix generation for 23404910351: NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员 (attempts=1)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Skipped 8 items due to generation failures or proxy issues (production mode)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] Generated 0 items in 439ms (0ms/item avg)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [Stock] 批量补货完成: 27 campaigns, 539ms (0.5s)
Feb 05 10:15:43 iZj6cj6h20j6kz2vmuzviqZ npm[2248220]: [replenish-stream] 流关闭
