// Expo monorepo Metro config.
//
// NEDEN GEREKLI?
// Bu bir Turborepo/npm-workspaces monorepo'su. Metro varsayılan ayarlarda hem
// kökteki hem de apps/mobile içindeki node_modules'u tarar ve React'in İKİ
// kopyasını bulur (kök: web app'ler için react 19.2.x, mobil: react 19.1.0).
// react-native renderer bir kopyayı, uygulama kodu diğerini yükleyince React'in
// iç "dispatcher"ı paylaşılmaz ve "Cannot read property 'useState' of null"
// hatası çıkar.
//
// Çözüm: Metro'ya yalnızca belirttiğimiz node_modules klasörlerini, sıralı
// şekilde taramasını söylüyoruz (önce mobil, sonra kök) ve hiyerarşik aramayı
// kapatıyoruz. Böylece React her yerde TEK kopyaya çözümleniyor.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Monorepo kökündeki tüm dosyaları izle (workspace paketleri için)
config.watchFolders = [workspaceRoot];

module.exports = config;
