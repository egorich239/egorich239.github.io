---
layout: page
title: Using string literals as template arguments in C++17
redirect_from:
  - /2020/10/08/cpp-c-literals-as-template-args.html
  - /posts/p0001.html
---


**Update 2021-08-04:** I fixed some bugs in the code that prevented its compilation (see in part 3) and 
[published](https://github.com/egorich239/typed_literals/) a working demo.

Consider your C++ application has some global state that is accessed by a string key *and* you would like to avoid 
explicit definition of storage per key. For example, your application uses a set of named copy-paste buffers to exchange
information in the following fashion:

```c++
  std::vector<uint8_t> data = readDataFromBuffer("foo");
  data.push_back(42);
  writeDataToBuffer("foo", data);
```

Here "foo" is the name of the copy-paste buffer. It is a compile time constant, a `constexpr` in fact. This buffer can
be accessed from different translation units and we do not want to explicitly define a storage for "foo". What do we do?

A typical solution would use a static map:

```c++
struct StorageAndMutex {
  std::mutex mu;
  std::map<std::string, std::vector<uint8_t>> data;
};

static StorageAndMutex& getStorage() {
  static StorageAndMutex storage;
  return storage;
}

std::vector<uint8_t> readDataFromBuffer(std::string_view name) {
  std::lock_guard l(getStorage().mu);
  if (auto it = getStorage().data.find(name); it != getStorage().data.end()) {
    return *it;
  }
  return {};
}
```

This works but involves a `std::map` lookup every time you read from the buffer despite the fact that we know at
compile time which exact map element we are going to look up. Note however that the names are compile time constants, 
and the overall set of those keys is known at linking time. What if we could allocate a storage per key statically?

## Chapter 1. Template classes as static storage

In this chapter I shortly describe how template classes can be used for static storage.

Consider for a moment that our key is `int` instead of a string literal. Then the following implementation is possible:

```c++
template <int Key>
struct ValueStorage {
  static std::mutex mu;
  static std::vector<uint8_t> data;
};
template <int Key>
std::mutex ValueStorage<Key>::mu{};
template <int Key>
std::vector<uint8_t> ValueStorage<Key>::data{};

#define readDataFromBuffer(key_) \
  []{                            \
     std::lock_guard l(ValueStorage<(key_)>::mu); \
     return ValueStorage<(key_)>::data;           \
  }()
```

We define a template class `ValueStorage` that has two static fields, and use a macro to access those fields.

One detail worth mentioning however is the usage of `key_` inside the lambda: the lambda captures nothing,
so `key_` must be either a constant expression or a named `constexpr` for this to work.

If I read [cppreference.com](https://en.cppreference.com/w/cpp/language/consteval) correctly, as of C++20 
it should be valid to define `readDataFromBuffer()` as a `consteval` function instead of a macro.
**Update** *I read it wrong, see the final remarks.*

## Chapter 2. It does not work for strings, what can we do?

The above solution does not work for string literal keys. There is no way to have a string type as a non-type template
parameter. There is an [amazing Quora answer](https://www.quora.com/How-do-you-pass-a-string-literal-as-a-parameter-to-a-C-template-class) by David Vandevoorde,
suggesting that some time around 2023 that may become an option. But what do we do in 2020?

One thing we could do is replace the string literal with a type representing it:

```c++
template <char... Chars>
struct CLiteral {
  static constexpr const char data[] = {Chars..., '\0'};
  static constexpr const size_t size = sizeof...(Chars);
};
```

So, the string literal "foo" is represented by `CLiteral<'f', 'o', 'o'>`. Then we replace `ValueStorage` template argument with a type.

```c++
template <typename CLiteralKeyType> struct ValueStorage;
```

Now the key question is of course how to conveniently map a literal to its corresponding type. Typing `CLiteral<'f', 'o', 'o'>` is no fun.

## Chapter 3. Producing the type

I first present a C++17 macro that produces an expression of the necessary type, and then explain it.

```c++
#define makeLiteralTypeValue(lit_) \
  std::apply(                      \
    [](auto... indices) { return CLiteral<(lit_)[decltype(indices)::value]...>(); }, \
    makeTuple(std::make_index_sequence<constexprStrLen(lit_)>()))

template <size_t... Idx>
constexpr std::tuple<std::integral_constant<size_t, Idx>...> 
makeTuple(std::index_sequence<Idx...>) noexcept { return {}; }

constexpr size_t constexprStrLen(const char* c) {
  size_t t = 0;
  while (*c++) ++t;
  return t;
}
```
    
The key idea is to define and call a lambda with the expansion pack. We completely ignore the values of `indices`
and only care for their types. Elements of `indices` pack have types `std::integral_constant<size_t, 0>` to
`std::integral_constant<size_t, strlen(lit_) - 1>`. They all have `constexpr operator()` that returns its integral
constant value. The second argument to the call generates the tuple consisting of the variables of these integral types.
The simplest way I found to generate it is to use `makeTuple` utility that converts a value of 
`std::index_sequence<0, 1, ..., strlen(lit_) - 1>` type to a tuple where each element has a unique
type from `std::integral_constant<size_t, 0>` to `std::integral_constant<size_t, strlen(lit_) - 1>`. Calling
`std::apply` on this tuple unpacks its arguments and passes into the lambda.

**Update 2021-08-04:** An earlier version of the code passed `indices` by universal reference (`auto&&`) and
attempted to call `indices()` in the expression `(lit_)[indices()]...`. This does not work, because it pulls the dependency
on the *values* of `indices...` into the template argument. Instead we should depend on the *types* of `indices`,
hence `(lit_)[decltype(indices)::value]...`. Also this `decltype()` does not work with `auto&&` because `decltype(indices)`
resolves into a reference, the simplest solution to that is to drop the universal reference and leave just `auto...`.

All we need to do is to get the type of this expression. Unfortunately this expression contains a lambda and
as such we cannot call `decltype(makeLiteralTypeValue("foo"))` directly (IANAL: recent C++ standards are relaxing 
some of these restrictions but my attempt to naively use `decltype()` failed and I didn't research any further).

Instead we can assign the expression to a named variable. It can technically be even `constexpr` but in my practice
some (rather old) compilers would disagree with you. That is not a problem however, as we are only interested
in the *type* and not the value.

With all of the above said, here is the implementation of `readDataFromBuffer`:

```c++
#define readDataFromBuffer(lit_) \
  []{                            \
      auto cLiteralValue = makeLiteralTypeValue(lit_);       \
      using Storage = ValueStorage<decltype(cLiteralValue)>; \
      std::lock_guard l(Storage::mu);                        \
      return Storage::data;                                  \
  }()
```

## Final remarks

- IIUC `consteval` is not going to help in C++20: Indeed if it would work the way I suggested, that would mean
  that the type of the function output depends not only on the *type* of `lit_` but also on its *value*:
  "foo" produces a value of `CLiteral<'f', 'o', 'o'>` but value "bar" *of the same type* produces `CLiteral<'b', 'a', 'r'>`.
  With the macro we get away with it only because macro is in the end nothing but a text substitution creating its own
  lambda every time the macro is used.
- `lit_` can be any `constexpr` with `constexpr operator[]` defined. Some common string view style types I have
  come across in the wild have `constexpr data()` but `operator[]` being non-`constexpr`. A simple utility function
  would work around those limitations.
- Your compiler may issue unused variable or shadow name for `cLiteralValue` and `Storage`. Heck, use some magic 
  attributes and a terrible prefix for them :-)