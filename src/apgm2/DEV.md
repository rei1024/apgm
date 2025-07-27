APGM2

C、Rust、JavaScriptを参考にする。

```apgm2
// グローバル変数
// int型の符号はUnレジスタのフラグに保存
let a: int = 0;
let b: nat = 0;
let c: unaryint = 0;
let d: unarynat = 0;

fn main() {
    // ローカル変数
    let a: int = 0;
    let b: nat = 0;
    let c: unaryint = 0;
    let d: unarynat = 0;

    if c != 0 {
        system.output("0");
        c--;
    }
}
```

// B0: Stack

最小構成から考える。

- グローバル変数。
- 型はunarynatのみ。
- 関数はmainのみ宣言可。
- マクロ無し
- 演算は != 0、== 0、++、--のみ → 代入は？
  - x != 0は sys.u.tdec(x) = 0
  - x = y; // yが指し示すレジスタの値をxが指すレジスタに代入
  - x = 0; // xを0にする
- sys.b2d.inc_x()
- sys.b2d.tdec_x()
