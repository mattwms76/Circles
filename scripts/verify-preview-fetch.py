"""Read-only web Preview smoke check; needs Playwright and a running Circles app."""
import os
from playwright.sync_api import sync_playwright

preview = os.environ["EXPO_WEB_PREVIEW_URL"].rstrip("/")
api = os.environ["EXPO_PUBLIC_API_BASE_URL"].rstrip("/")

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="/usr/bin/chromium",
        args=["--no-sandbox"],
    )
    context = browser.new_context(viewport={"width": 1100, "height": 850})
    # Neither the embedded feed nor its requests may depend on the API host.
    context.route(api + "/**", lambda route: route.abort())
    page = context.new_page()
    responses = []
    failures = []
    page.on(
        "response",
        lambda response: responses.append((response.url, response.status))
        if "/api/" in response.url
        else None,
    )
    page.on(
        "requestfailed",
        lambda request: failures.append(request.url)
        if "/api/" in request.url
        else None,
    )
    # A blank top-level origin makes the real Preview a cross-site child frame.
    page.set_content(
        '<!doctype html><title>Embedded Preview verification</title>'
        f'<iframe src="{preview}" style="width:100%;height:800px;border:0"></iframe>'
    )
    frame = page.frame_locator("iframe")
    frame.get_by_text("Jules Park", exact=True).first.wait_for(timeout=60000)
    body = frame.locator("body").inner_text()
    post = frame.locator("body").evaluate(
        """async () => {
            const response = await fetch('/api/health', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                credentials: 'include',
                body: '{}'
            });
            return response.status;
        }"""
    )
    assert "Failed to fetch" not in body, "A fetch failure is still visible"
    assert responses, "No API responses were observed"
    assert all(url.startswith(preview + "/") for url, _ in responses)
    assert not failures, f"Failed API requests: {failures}"
    assert any(status == 200 for _, status in responses)
    # POST health is deliberately not a route; 404 proves it reached Express,
    # rather than being rejected with origin_not_allowed by CORS. No write occurs.
    assert post == 404, f"Same-origin POST unexpectedly rejected: {post}"
    print("Embedded guest feed rendered with the old API host blocked.")
    print("API requests use Preview origin; no failed requests or fetch-error text.")
    print("Safe POST reached the API without origin rejection.")
    context.close()
    browser.close()
