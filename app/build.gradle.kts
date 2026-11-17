import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Spelet ligger i web/ i repots rot (index.html + js/). Här kopieras det in som app-assets vid varje bygge,
// så det finns ingen separat kopia att hålla i synk.
val webAssets = layout.buildDirectory.dir("webassets")
val copyWeb by tasks.registering(Copy::class) {
    from(rootProject.file("web"))
    into(webAssets)
}

android {
    namespace = "com.gr8eam.springtrain"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.gr8eam.springtrain"
        minSdk = 26
        targetSdk = 36
        // CI skickar -PbuildNumber=<körningsnummer>; testbyggen får då versionen 0.1.0-test.<n>.
        // Bygget för Google Play (-PplayRelease) får versionsnamnet playVersion; versionskoden är alltid körningsnumret.
        val baseVersion = "0.1.0"
        val playVersion = "1.0.0"
        val buildNumber = (project.findProperty("buildNumber") as String?)?.toIntOrNull()
        versionCode = buildNumber ?: 1
        versionName = if (project.hasProperty("playRelease")) playVersion
            else if (buildNumber != null) "$baseVersion-test.$buildNumber" else "$baseVersion-dev"
    }

    signingConfigs {
        // Testnyckel (publik med flit) så att varje CI-bygge kan installeras ovanpå det förra.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        // Riktiga utgåvor signeras med nyckel från GitHub secrets (se build.yml).
        create("release") {
            val ksPath = System.getenv("RELEASE_KEYSTORE")
            if (ksPath != null && file(ksPath).exists()) {
                storeFile = file(ksPath)
                storePassword = System.getenv("RELEASE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("RELEASE_KEY_ALIAS")
                keyPassword = System.getenv("RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug" // testappen kan ligga bredvid den riktiga utgåvan
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            val rel = signingConfigs.getByName("release")
            signingConfig = if (rel.storeFile != null) rel else null
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets {
        getByName("main").kotlin.srcDirs("src/main/kotlin")
        getByName("main").assets.srcDirs(webAssets)
    }
    lint {
        abortOnError = false
    }
}

tasks.named("preBuild") { dependsOn(copyWeb) }

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
}
