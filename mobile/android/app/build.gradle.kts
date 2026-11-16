plugins {
    id("com.android.application")
}

// The web app this Trusted Web Activity opens (verified via /.well-known/assetlinks.json on that host).
val siteHost: String = (project.findProperty("siteHost") as String?) ?: "northeside.netlify.app"
val siteUrl = "https://$siteHost"

android {
    namespace = "com.northeside.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.northeside.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 3
        versionName = "1.0.2"

        resValue("string", "appName", "Northeside")
        resValue("string", "launcherName", "Northeside")
        resValue("string", "hostName", siteHost)
        resValue("string", "launchUrl", "$siteUrl/?utm_source=android")
        resValue("string", "providerAuthority", "com.northeside.app.fileprovider")
        resValue(
            "string",
            "assetStatements",
            "[{ \\\"relation\\\": [\\\"delegate_permission/common.handle_all_urls\\\"], \\\"target\\\": {\\\"namespace\\\": \\\"web\\\", \\\"site\\\": \\\"$siteUrl\\\"}}]",
        )
    }

    // The release key never lives in the repository: pass its location and passwords in the environment.
    signingConfigs {
        create("release") {
            val store = System.getenv("NS_KEYSTORE")
            if (store != null) {
                storeFile = file(store)
                storePassword = System.getenv("NS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NS_KEY_ALIAS") ?: "northeside"
                keyPassword = System.getenv("NS_KEY_PASSWORD") ?: System.getenv("NS_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("NS_KEYSTORE") != null) signingConfigs.getByName("release") else null
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")

    // Launch tests run the real launcher on Robolectric (no device needed).
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("androidx.test:core:1.6.1")
}
