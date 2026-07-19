import express from "express";
import mongoose, { Schema, type Document } from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
const allowedOrigins = process.env.NEXT_PUBLIC_API_URL?.split(",") || [];
app.use(cors({ origin: allowedOrigins }));
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

// Wait for MongoDB connection before processing any requests
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    try { await connectDB(); } catch { return res.status(503).json({ success: false, message: "Database not connected" }); }
  }
  next();
});

function param(params: Record<string, string | undefined>, key: string): string {
  const val = params[key];
  if (!val) throw new Error(`Missing route param: ${key}`);
  return val;
}

// ============================================================
// PHASE 1: MONGOOSE SCHEMAS & MODELS
// ============================================================

// --- Category Schema ---
interface ICategory extends Document {
  name: string;
  slug: string;
  image?: string;
  createdAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    image: { type: String, default: "" },
  },
  { timestamps: true }
);

const Category = mongoose.model<ICategory>("Category", categorySchema);

// --- Brand Schema ---
interface IBrand extends Document {
  name: string;
  slug: string;
  logo?: string;
  createdAt: Date;
}

const brandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    logo: { type: String, default: "" },
  },
  { timestamps: true }
);

const Brand = mongoose.model<IBrand>("Brand", brandSchema);

// --- Product Schema ---
interface IProduct extends Document {
  name: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  sku?: string;
  stock: number;
  images: string[];
  category: string;
  brand: string;
  status: "Active" | "Draft" | "Out of Stock";
  ratings: {
    average: number;
    count: number;
  };
  createdAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, default: null },
    sku: { type: String, default: "" },
    stock: { type: Number, required: true, default: 0, min: 0 },
    images: [{ type: String }],
    category: { type: String, required: true },
    brand: { type: String, required: true },
    status: {
      type: String,
      enum: ["Active", "Draft", "Out of Stock"],
      default: "Draft",
    },
    ratings: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

const Product = mongoose.model<IProduct>("Product", productSchema);

// --- Order Schema ---
interface IOrderItem {
  productId: mongoose.Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  image?: string;
}

interface IOrder extends Document {
  userId: string;
  items: IOrderItem[];
  totalAmount: number;
  shippingAddress: {
    fullName: string;
    address: string;
    city: string;
    postalCode: string;
    country: string;
  };
  paymentStatus: "Pending" | "Paid" | "Failed";
  orderStatus: "Processing" | "Shipped" | "Delivered" | "Cancelled";
  createdAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    userId: { type: String, required: true },
    items: [
      {
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true, min: 1 },
        image: { type: String, default: "" },
      },
    ],
    totalAmount: { type: Number, required: true },
    shippingAddress: {
      fullName: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true },
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Pending",
    },
    orderStatus: {
      type: String,
      enum: ["Processing", "Shipped", "Delivered", "Cancelled"],
      default: "Processing",
    },
  },
  { timestamps: true }
);

const Order = mongoose.model<IOrder>("Order", orderSchema);

// --- Cart Schema ---
interface ICartItem {
  productId: mongoose.Types.ObjectId;
  quantity: number;
}

interface ICart extends Document {
  userId: string;
  items: ICartItem[];
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const cartSchema = new Schema<ICart>(
  {
    userId: { type: String, required: true, unique: true },
    items: [cartItemSchema],
  },
  { timestamps: true }
);

const Cart = mongoose.model<ICart>("Cart", cartSchema);

// ============================================================
// HEALTH CHECK ROUTE
// ============================================================
app.get("/", (req, res) => {
  res.json({
    message: "✅ TechShop API is running",
    models: ["Product", "Category", "Brand", "Order", "Cart"],
    phase: "Phase 1 Complete",
  });
});

// ============================================================
// PHASE 2: PRODUCT, CATEGORY & BRAND ROUTES
// ============================================================

// --- CATEGORY ROUTES ---

// PATCH /api/categories/:id - Update a category
app.patch("/api/categories/:id", async (req, res) => {
  try {
    const { name, slug, image } = req.body;
    if (!name && !slug && !image) {
      return res.status(400).json({ success: false, message: "At least one field (name, slug, image) is required" });
    }
    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (slug) updates.slug = slug;
    if (image !== undefined) updates.image = image;
    const category = await Category.findByIdAndUpdate(
      param(req.params, "id"),
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    res.json({ success: true, data: category });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A category with this slug already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to update category" });
  }
});

// GET /api/categories - Get all categories
app.get("/api/categories", async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 });
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch categories" });
  }
});

// POST /api/categories - Create a new category
app.post("/api/categories", async (req, res) => {
  try {
    const { name, slug, image } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: "Name and slug are required" });
    }
    const category = await Category.create({ name, slug, image });
    res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A category with this slug already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to create category" });
  }
});

// DELETE /api/categories/:id - Delete a category
app.delete("/api/categories/:id", async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(param(req.params, "id"));
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });
    res.json({ success: true, message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete category" });
  }
});

// --- BRAND ROUTES ---

// PATCH /api/brands/:id - Update a brand
app.patch("/api/brands/:id", async (req, res) => {
  try {
    const { name, slug, logo } = req.body;
    if (!name && !slug && !logo) {
      return res.status(400).json({ success: false, message: "At least one field (name, slug, logo) is required" });
    }
    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (slug) updates.slug = slug;
    if (logo !== undefined) updates.logo = logo;
    const brand = await Brand.findByIdAndUpdate(
      param(req.params, "id"),
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!brand) return res.status(404).json({ success: false, message: "Brand not found" });
    res.json({ success: true, data: brand });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A brand with this slug already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to update brand" });
  }
});

// GET /api/brands - Get all brands
app.get("/api/brands", async (req, res) => {
  try {
    const brands = await Brand.find().sort({ createdAt: -1 });
    res.json({ success: true, data: brands });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch brands" });
  }
});

// POST /api/brands - Create a new brand
app.post("/api/brands", async (req, res) => {
  try {
    const { name, slug, logo } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: "Name and slug are required" });
    }
    const brand = await Brand.create({ name, slug, logo });
    res.status(201).json({ success: true, data: brand });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A brand with this slug already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to create brand" });
  }
});

// DELETE /api/brands/:id - Delete a brand
app.delete("/api/brands/:id", async (req, res) => {
  try {
    const brand = await Brand.findByIdAndDelete(param(req.params, "id"));
    if (!brand) return res.status(404).json({ success: false, message: "Brand not found" });
    res.json({ success: true, message: "Brand deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete brand" });
  }
});

// --- PRODUCT ROUTES ---

// GET /api/products - Get all products (with search, filter, pagination)
app.get("/api/products", async (req, res) => {
  try {
    const { search, category, brand, status, page = "1", limit = "20" } = req.query;

    const query: Record<string, any> = {};
    if (search) query.name = { $regex: search, $options: "i" };
    if (category) query.category = category;
    if (brand) query.brand = brand;
    if (status) query.status = status;

    let pageNum = parseInt(page as string);
    let limitNum = parseInt(limit as string);
    if (isNaN(pageNum) || pageNum < 1) pageNum = 1;
    if (isNaN(limitNum) || limitNum < 1) limitNum = 20;
    if (limitNum > 100) limitNum = 100;
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Product.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: products,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch products" });
  }
});

// GET /api/products/:id - Get a single product
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(param(req.params, "id"));
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch product" });
  }
});

// POST /api/products - Create a new product
app.post("/api/products", async (req, res) => {
  try {
    const { name, description, price, compareAtPrice, sku, stock, images, category, brand, status } = req.body;
    if (!name || !price || !category || !brand) {
      return res.status(400).json({ success: false, message: "Name, price, category, and brand are required" });
    }
    const product = await Product.create({
      name, description, price, compareAtPrice, sku, stock, images, category, brand, status,
    });
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to create product" });
  }
});

// PATCH /api/products/:id - Update a product
app.patch("/api/products/:id", async (req, res) => {
  try {
    const allowedFields = ["name", "description", "price", "compareAtPrice", "sku", "stock", "images", "category", "brand", "status"];
    const updates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }
    const product = await Product.findByIdAndUpdate(
      param(req.params, "id"),
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update product" });
  }
});

// DELETE /api/products/:id - Delete a product
app.delete("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(param(req.params, "id"));
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete product" });
  }
});

// ============================================================
// PHASE 3: ORDER ROUTES & USERS ROUTE
// ============================================================

// POST /api/orders - Create a new order (Checkout)
app.post("/api/orders", async (req, res) => {
  try {
    const { userId, items, shippingAddress } = req.body;

    if (!userId || !items || !items.length || !shippingAddress) {
      return res.status(400).json({
        success: false,
        message: "userId, items, and shippingAddress are required",
      });
    }

    // Calculate total from items
    const totalAmount = items.reduce(
      (sum: number, item: { price: number; quantity: number }) =>
        sum + item.price * item.quantity,
      0
    );

    const order = await Order.create({
      userId,
      items,
      totalAmount,
      shippingAddress,
      paymentStatus: "Pending",
      orderStatus: "Processing",
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to create order" });
  }
});

// GET /api/orders - Get ALL orders (Admin)
app.get("/api/orders", async (req, res) => {
  try {
    const { status, page = "1", limit = "20" } = req.query;

    const query: Record<string, any> = {};
    if (status) query.orderStatus = status;

    let pageNum = parseInt(page as string);
    let limitNum = parseInt(limit as string);
    if (isNaN(pageNum) || pageNum < 1) pageNum = 1;
    if (isNaN(limitNum) || limitNum < 1) limitNum = 20;
    if (limitNum > 100) limitNum = 100;
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Order.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
});

// GET /api/orders/user/:userId - Get orders for a specific user
app.get("/api/orders/user/:userId", async (req, res) => {
  try {
    const orders = await Order.find({ userId: param(req.params, "userId") }).sort({
      createdAt: -1,
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch user orders" });
  }
});

// GET /api/orders/:id - Get a single order by ID
app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = await Order.findById(param(req.params, "id"));
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch order" });
  }
});

// PATCH /api/orders/:id/status - Update order status (Admin)
app.patch("/api/orders/:id/status", async (req, res) => {
  try {
    const { orderStatus, paymentStatus } = req.body;

    const validOrderStatuses = ["Processing", "Shipped", "Delivered", "Cancelled"];
    const validPaymentStatuses = ["Pending", "Paid", "Failed"];

    if (orderStatus && !validOrderStatuses.includes(orderStatus)) {
      return res.status(400).json({ success: false, message: "Invalid orderStatus value" });
    }
    if (paymentStatus && !validPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({ success: false, message: "Invalid paymentStatus value" });
    }

    const updateFields: Record<string, string> = {};
    if (orderStatus) updateFields.orderStatus = orderStatus;
    if (paymentStatus) updateFields.paymentStatus = paymentStatus;

    const order = await Order.findByIdAndUpdate(
      param(req.params, "id"),
      { $set: updateFields },
      { new: true }
    );

    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update order status" });
  }
});

// ============================================================
// CART ROUTES
// ============================================================

// GET /api/cart/:userId - Get user's cart (populated with product details)
app.get("/api/cart/:userId", async (req, res) => {
  try {
    let cart = await Cart.findOne({ userId: param(req.params, "userId") })
      .populate("items.productId", "name price images stock status category");

    if (!cart) {
      cart = await Cart.create({ userId: req.params.userId, items: [] });
    }

    res.json({ success: true, data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch cart" });
  }
});

// POST /api/cart/add - Add item to cart (or increment quantity)
app.post("/api/cart/add", async (req, res) => {
  try {
    const { userId, productId, quantity = 1 } = req.body;
    if (!userId || !productId) {
      return res.status(400).json({ success: false, message: "userId and productId are required" });
    }

    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = await Cart.create({ userId, items: [{ productId, quantity }] });
    } else {
      const existing = cart.items.find(
        (i) => i.productId.toString() === productId
      );
      if (existing) {
        existing.quantity += quantity;
      } else {
        cart.items.push({ productId, quantity });
      }
      await cart.save();
    }

    await cart.populate("items.productId", "name price images stock status category");
    res.json({ success: true, data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to add to cart" });
  }
});

// PATCH /api/cart/update - Update item quantity
app.patch("/api/cart/update", async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;
    if (!userId || !productId || quantity == null) {
      return res.status(400).json({ success: false, message: "userId, productId, and quantity are required" });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ success: false, message: "Cart not found" });
    }

    const item = cart.items.find((i) => i.productId.toString() === productId);
    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found in cart" });
    }

    if (quantity < 1) {
      cart.items = cart.items.filter(
        (i) => i.productId.toString() !== productId
      );
    } else {
      item.quantity = quantity;
    }

    await cart.save();
    await cart.populate("items.productId", "name price images stock status category");
    res.json({ success: true, data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update cart item" });
  }
});

// POST /api/cart/remove - Remove item from cart
app.post("/api/cart/remove", async (req, res) => {
  try {
    const { userId, productId } = req.body;
    if (!userId || !productId) {
      return res.status(400).json({ success: false, message: "userId and productId are required" });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ success: false, message: "Cart not found" });
    }

    cart.items = cart.items.filter(
      (i) => i.productId.toString() !== productId
    );
    await cart.save();
    await cart.populate("items.productId", "name price images stock status category");
    res.json({ success: true, data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to remove item from cart" });
  }
});

// DELETE /api/cart/:userId - Clear cart
app.delete("/api/cart/:userId", async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: param(req.params, "userId") });
    if (!cart) {
      return res.status(404).json({ success: false, message: "Cart not found" });
    }

    cart.items = [];
    await cart.save();
    res.json({ success: true, message: "Cart cleared", data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to clear cart" });
  }
});

// ============================================================
// USERS ROUTE (reads from Better Auth's 'user' collection)
// ============================================================

// GET /api/users - List all users
app.get("/api/users", async (req, res) => {
  try {
    // Better Auth stores users in a collection called "user"
    const db = mongoose.connection.db;
    if (!db) return res.status(503).json({ success: false, message: "Database not connected" });
    const users = await db
      .collection("user")
      .find({}, { projection: { password: 0 } }) // exclude password field
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
});

// ============================================================
// SERVER STARTUP / DB CONNECTION
// ============================================================

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoUri = process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error("DATABASE_URL environment variable is not defined");
    }

    // In serverless environments, connection should be cached
    if (mongoose.connection.readyState === 1) {
      return mongoose.connection;
    }

    await mongoose.connect(mongoUri, { dbName: "techshop" });
    console.log("✅ MongoDB Connected");
    console.log("📦 Models registered: Product, Category, Brand, Order");
  } catch (error) {
    console.error("❌ Database Connection Failed:", error);
    console.log("⚠️  Note: Database operations will fail until MongoDB is started.");
  }
};

const PORT = process.env.PORT || 9000;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

// Export the Express API for serverless environments (like Vercel)
export default app;


