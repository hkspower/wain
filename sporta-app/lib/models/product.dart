class Product {
  final String slug;
  final Map<String, String> name;
  final Map<String, String> desc;
  final double price;
  final String category;
  final String image;
  final Map<String, String>? badge;

  const Product({
    required this.slug,
    required this.name,
    required this.desc,
    required this.price,
    required this.category,
    required this.image,
    this.badge,
  });

  /// Apparel needs a size; accessories do not.
  List<String>? get sizes =>
      const {'women', 'men', 'outerwear'}.contains(category)
          ? const ['S', 'M', 'L', 'XL']
          : null;

  String nameIn(String lang) => name[lang] ?? name['en'] ?? '';
  String descIn(String lang) => desc[lang] ?? desc['en'] ?? '';

  factory Product.fromJson(Map<String, dynamic> j) => Product(
        slug: j['slug'] as String,
        name: Map<String, String>.from(j['name'] as Map),
        desc: Map<String, String>.from((j['desc'] ?? {}) as Map),
        price: (j['price'] as num).toDouble(),
        category: (j['category'] ?? '') as String,
        image: (j['image'] ?? '') as String,
        badge: j['badge'] == null ? null : Map<String, String>.from(j['badge'] as Map),
      );
}

class CartItem {
  final String slug;
  final String? size;
  final Map<String, String> name;
  final double price;
  final String image;
  int qty;

  CartItem({
    required this.slug,
    required this.size,
    required this.name,
    required this.price,
    required this.image,
    this.qty = 1,
  });

  String get key => '${slug}__${size ?? '-'}';
  double get lineTotal => price * qty;

  Map<String, dynamic> toJson() => {
        'slug': slug, 'size': size, 'name': name,
        'price': price, 'image': image, 'qty': qty,
      };

  factory CartItem.fromJson(Map<String, dynamic> j) => CartItem(
        slug: j['slug'], size: j['size'],
        name: Map<String, String>.from(j['name']),
        price: (j['price'] as num).toDouble(),
        image: j['image'], qty: j['qty'],
      );
}
