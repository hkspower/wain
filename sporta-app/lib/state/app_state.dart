import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/product.dart';
import '../services/api.dart';

/// Cart, wishlist, language and theme — persisted locally.
class AppState extends ChangeNotifier {
  static const _kCart = 'sporta_cart';
  static const _kWish = 'sporta_wishlist';
  static const _kLang = 'lang';
  static const _kTheme = 'sporta_theme';

  final List<CartItem> cart = [];
  final Set<String> wishlist = {};
  Locale locale = const Locale('en');
  ThemeMode themeMode = ThemeMode.system;

  List<Product> products = [];
  bool loading = true;
  String? error;

  int get count => cart.fold(0, (n, i) => n + i.qty);
  double get total => cart.fold(0.0, (s, i) => s + i.lineTotal);
  String get lang => locale.languageCode;

  Future<void> init() async {
    final p = await SharedPreferences.getInstance();
    locale = Locale(p.getString(_kLang) ?? 'en');
    final th = p.getString(_kTheme);
    themeMode = th == 'dark'
        ? ThemeMode.dark
        : th == 'light'
            ? ThemeMode.light
            : ThemeMode.system;
    for (final s in jsonDecode(p.getString(_kCart) ?? '[]') as List) {
      cart.add(CartItem.fromJson(Map<String, dynamic>.from(s as Map)));
    }
    wishlist.addAll((jsonDecode(p.getString(_kWish) ?? '[]') as List).cast<String>());
    notifyListeners();
    await loadProducts();
  }

  Future<void> loadProducts() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      products = await Api.products();
    } catch (e) {
      error = e.toString();
    }
    loading = false;
    notifyListeners();
  }

  Future<void> _save() async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kCart, jsonEncode(cart.map((i) => i.toJson()).toList()));
    await p.setString(_kWish, jsonEncode(wishlist.toList()));
    await p.setString(_kLang, locale.languageCode);
    await p.setString(
        _kTheme,
        themeMode == ThemeMode.dark
            ? 'dark'
            : themeMode == ThemeMode.light
                ? 'light'
                : 'system');
  }

  void add(Product p, {String? size, int qty = 1}) {
    final key = '${p.slug}__${size ?? '-'}';
    final found = cart.where((i) => i.key == key).firstOrNull;
    if (found != null) {
      found.qty += qty;
    } else {
      cart.add(CartItem(
          slug: p.slug, size: size, name: p.name,
          price: p.price, image: p.image, qty: qty));
    }
    _save();
    notifyListeners();
  }

  void setQty(String key, int qty) {
    cart.removeWhere((i) => i.key == key && qty <= 0);
    for (final i in cart) {
      if (i.key == key) i.qty = qty;
    }
    _save();
    notifyListeners();
  }

  void clearCart() {
    cart.clear();
    _save();
    notifyListeners();
  }

  void toggleWish(String slug) {
    wishlist.contains(slug) ? wishlist.remove(slug) : wishlist.add(slug);
    _save();
    notifyListeners();
  }

  void toggleLang() {
    locale = Locale(locale.languageCode == 'en' ? 'ar' : 'en');
    _save();
    notifyListeners();
  }

  void toggleTheme() {
    themeMode = themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    _save();
    notifyListeners();
  }
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull => isEmpty ? null : first;
}
