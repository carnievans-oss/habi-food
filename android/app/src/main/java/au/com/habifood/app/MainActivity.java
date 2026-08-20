package au.com.habifood.app;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * Habi-Food Android shell.
 *
 * The one thing this class exists for: make the web layer's type respect the
 * device's font-size setting, the way sp does for native views.
 *
 * A WebView does not do this on its own. Its textZoom stays at 100 no matter
 * what the user has chosen under Settings > Display > Font size, so a carer who
 * has scaled their phone's text up — which is the whole reason the setting
 * exists — would get no benefit from it inside the app. Copying the system
 * fontScale onto textZoom makes every rem in the stylesheet track that setting,
 * which is what turns the type scale in css/app.tailwind.css from pixels into
 * something equivalent to sp.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemFontScale();
    }

    /**
     * Font size can change while the app is running (the user changes it in
     * Settings and comes back), so re-apply on configuration change rather than
     * only at startup.
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemFontScale();
    }

    private void applySystemFontScale() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            return;
        }
        float fontScale = getResources().getConfiguration().fontScale;

        // Clamp to a range the layout is known to survive. The floor keeps the
        // 12sp minimum from shrinking below legibility; the ceiling matches the
        // 200% reflow the layout is tested at.
        float clamped = Math.max(0.85f, Math.min(fontScale, 2.0f));

        WebSettings settings = webView.getSettings();
        settings.setTextZoom(Math.round(clamped * 100));
    }
}
