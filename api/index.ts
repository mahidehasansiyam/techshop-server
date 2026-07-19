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

// ============================================================
// HEALTH CHECK ROUTE
// ============================================================
app.get("/", (req, res) => {
  res.json({
    message: "✅ TechShop API is running",
    models: ["Product", "Category", "Brand", "Order"],
    phase: "Phase 1 Complete",
  });
});

// ============================================================
// PHASE 2: PRODUCT, CATEGORY & BRAND ROUTES
// ============================================================

// --- CATEGORY ROUTES ---

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

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
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
    const product = await Product.findByIdAndUpdate(
      param(req.params, "id"),
      { $set: req.body },
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

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
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


