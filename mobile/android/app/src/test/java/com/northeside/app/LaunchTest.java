package com.northeside.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.robolectric.Shadows.shadowOf;

import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import androidx.test.core.app.ApplicationProvider;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowPackageManager;

/** Opens the app's launcher the way the home screen does, on phones with and without Chrome. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 34})
public class LaunchTest {
    private static final String SITE = "https://northeside.netlify.app/?utm_source=android";

    @org.junit.Before
    public void logs() throws Exception {
        org.robolectric.shadows.ShadowLog.stream = System.out;
        // The library counts live launchers in a static; each test is a fresh app start.
        java.lang.reflect.Field f = LauncherActivity.class.getDeclaredField("sLauncherActivitiesAlive");
        f.setAccessible(true);
        f.setInt(null, 0);
    }


    private Intent launcherIntent() {
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        i.setComponent(new ComponentName(ApplicationProvider.getApplicationContext(), LauncherActivity.class));
        // As the home screen launches apps.
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return i;
    }

    @Test
    public void noBrowserAtAll_opensTheSiteInsideTheApp() {
        ActivityController<LauncherActivity> c = Robolectric.buildActivity(LauncherActivity.class, launcherIntent()).setup();
        Intent next = shadowOf(c.get()).getNextStartedActivity();
        assertNotNull("the launcher must open something", next);
        assertEquals("com.google.androidbrowserhelper.trusted.WebViewFallbackActivity", next.getComponent().getClassName());
    }

    @Test
    public void otherBrowserWithoutTwaSupport_opensTheSiteInsideTheApp() {
        installBrowser("com.transsion.phoenix", false);
        ActivityController<LauncherActivity> c = Robolectric.buildActivity(LauncherActivity.class, launcherIntent()).setup();
        org.robolectric.shadows.ShadowLooper.idleMainLooper();
        Intent next = shadowOf(c.get()).getNextStartedActivity();
        assertNotNull("the launcher must open something", next);
        assertEquals("com.google.androidbrowserhelper.trusted.WebViewFallbackActivity", next.getComponent().getClassName());
    }

    @Test
    public void chromeInstalled_isPickedToOpenTheSiteFullScreen() {
        installBrowser("com.android.chrome", true);
        com.google.androidbrowserhelper.trusted.TwaProviderPicker.Action a =
                com.google.androidbrowserhelper.trusted.TwaProviderPicker.pickProvider(
                        ApplicationProvider.getApplicationContext().getPackageManager());
        assertEquals(com.google.androidbrowserhelper.trusted.TwaProviderPicker.LaunchMode.TRUSTED_WEB_ACTIVITY, a.launchMode);
        assertEquals("com.android.chrome", a.provider);
    }

    private void installBrowser(String pkg, boolean customTabs) {
        ShadowPackageManager pm = shadowOf(ApplicationProvider.getApplicationContext().getPackageManager());
        PackageInfo info = new PackageInfo();
        info.packageName = pkg;
        info.versionName = "131.0.0.0";
        info.applicationInfo = new ApplicationInfo();
        info.applicationInfo.packageName = pkg;
        info.applicationInfo.enabled = true;
        // Real browsers are signed; the launcher fingerprints the browser it hands the site to.
        android.content.pm.Signature sig = new android.content.pm.Signature("0102030405060708");
        info.signatures = new android.content.pm.Signature[] {sig};
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            android.content.pm.SigningInfo si = org.robolectric.shadow.api.Shadow.newInstanceOf(android.content.pm.SigningInfo.class);
            shadowOf(si).setSignatures(new android.content.pm.Signature[] {sig});
            info.signingInfo = si;
        }
        pm.installPackage(info);

        ComponentName browser = new ComponentName(pkg, pkg + ".Main");
        pm.addActivityIfNotPresent(browser);
        IntentFilter view = new IntentFilter(Intent.ACTION_VIEW);
        view.addCategory(Intent.CATEGORY_BROWSABLE);
        view.addCategory(Intent.CATEGORY_DEFAULT);
        view.addDataScheme("http");
        view.addDataScheme("https");
        try {
            pm.addIntentFilterForActivity(browser, view);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        ResolveInfo ri = new ResolveInfo();
        ri.activityInfo = new ActivityInfo();
        ri.activityInfo.packageName = pkg;
        ri.activityInfo.name = pkg + ".Main";
        ri.activityInfo.applicationInfo = info.applicationInfo;
        pm.addResolveInfoForIntent(new Intent(Intent.ACTION_VIEW, Uri.parse("http://")), ri);
        pm.addResolveInfoForIntent(new Intent(Intent.ACTION_VIEW, Uri.parse(SITE)), ri);

        if (customTabs) {
            ResolveInfo svc = new ResolveInfo();
            svc.serviceInfo = new ServiceInfo();
            svc.serviceInfo.packageName = pkg;
            svc.serviceInfo.name = pkg + ".CustomTabsService";
            svc.serviceInfo.applicationInfo = info.applicationInfo;
            // Chrome declares Trusted Web Activity support on its Custom Tabs service.
            svc.filter = new IntentFilter("android.support.customtabs.action.CustomTabsService");
            svc.filter.addCategory("androidx.browser.trusted.category.TrustedWebActivities");
            Intent cct = new Intent("android.support.customtabs.action.CustomTabsService");
            pm.addResolveInfoForIntent(cct, svc);
            Intent cctPkg = new Intent("android.support.customtabs.action.CustomTabsService").setPackage(pkg);
            pm.addResolveInfoForIntent(cctPkg, svc);
        }
    }
}
