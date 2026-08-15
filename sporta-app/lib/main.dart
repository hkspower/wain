import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'l10n.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'screens/home_screen.dart';
import 'screens/shop_screen.dart';
import 'screens/cart_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ChangeNotifierProvider(
      create: (_) => AppState()..init(),
      child: const SportaApp(),
    ),
  );
}

class SportaApp extends StatelessWidget {
  const SportaApp({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return MaterialApp(
      title: 'Sporta',
      debugShowCheckedModeBanner: false,
      theme: lightTheme,
      darkTheme: darkTheme,
      themeMode: app.themeMode,
      locale: app.locale,
      supportedLocales: const [Locale('en'), Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const RootShell(),
    );
  }
}

/// Bottom-tab shell: Home · Shop · Bag, with language and theme toggles.
class RootShell extends StatefulWidget {
  const RootShell({super.key});
  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  int index = 0;

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final app = context.watch<AppState>();
    final pages = [const HomeScreen(), const ShopScreen(), const CartScreen()];

    return Scaffold(
      appBar: index == 0
          ? AppBar(
              title: Text(l.appName,
                  style: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: .5)),
              leading: IconButton(
                icon: const Icon(Icons.language, size: 20),
                tooltip: 'Language',
                onPressed: () => context.read<AppState>().toggleLang(),
              ),
              actions: [
                IconButton(
                  icon: Icon(app.themeMode == ThemeMode.dark
                      ? Icons.light_mode_outlined
                      : Icons.dark_mode_outlined),
                  tooltip: 'Theme',
                  onPressed: () => context.read<AppState>().toggleTheme(),
                ),
              ],
            )
          : null,
      body: IndexedStack(index: index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => index = i),
        destinations: [
          NavigationDestination(
              icon: const Icon(Icons.home_outlined),
              selectedIcon: const Icon(Icons.home),
              label: l.home),
          NavigationDestination(
              icon: const Icon(Icons.grid_view_outlined),
              selectedIcon: const Icon(Icons.grid_view),
              label: l.shop),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: app.count > 0,
              label: Text('${app.count}'),
              child: const Icon(Icons.shopping_bag_outlined),
            ),
            selectedIcon: const Icon(Icons.shopping_bag),
            label: l.bag,
          ),
        ],
      ),
    );
  }
}
