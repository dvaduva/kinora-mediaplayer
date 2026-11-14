import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing: KINORA_RELEASE_* from ~/.gradle/gradle.properties (or the environment); the keystore never goes into git.
fun signing(name: String): String? = (findProperty(name) as String?)?.takeIf { it.isNotBlank() } ?: System.getenv(name)?.takeIf { it.isNotBlank() }
val keystorePath: String? = signing("KINORA_RELEASE_STORE_FILE")

android {
    namespace = "com.kinora.tv"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.kinora.tv"
        minSdk = 23
        targetSdk = 35
        versionCode = (property("kinora.versionCode") as String).toInt()
        versionName = property("kinora.versionName") as String
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = signing("KINORA_RELEASE_STORE_PASSWORD")
                keyAlias = signing("KINORA_RELEASE_KEY_ALIAS")
                keyPassword = signing("KINORA_RELEASE_KEY_PASSWORD") ?: signing("KINORA_RELEASE_STORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    val media3 = "1.11.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.webkit:webkit:1.14.0")
}

// The shell is built by apps/tv-shell (pnpm tv:shell) into src/main/assets/shell, which is not in git.
val shellIndex = file("src/main/assets/shell/index.html")
val checkShell by tasks.registering {
    doLast {
        if (!shellIndex.exists()) throw GradleException("The TV shell is missing from src/main/assets/shell. Run `pnpm tv:shell` (or `pnpm tv:package:android`) first.")
    }
}
tasks.named("preBuild") { dependsOn(checkShell) }
