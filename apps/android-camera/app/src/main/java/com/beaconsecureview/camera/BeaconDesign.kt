package com.beaconsecureview.camera

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal val BeaconDarkColorScheme =
    darkColorScheme(
        primary = Color(0xFF3B82F6),
        onPrimary = Color.White,
        primaryContainer = Color(0xFF172A4D),
        onPrimaryContainer = Color(0xFF60A5FA),
        secondary = Color(0xFFA1A1AA),
        background = Color(0xFF09090B),
        surface = Color(0xFF18181B),
        surfaceVariant = Color(0xFF27272A),
        onSurface = Color(0xFFF9FAFB),
        onSurfaceVariant = Color(0xFFA1A1AA),
        outline = Color(0xFF52525B),
        outlineVariant = Color(0xFF3F3F46),
        error = Color(0xFFF87171),
    )

internal val BeaconLive = Color(0xFFDC2626)
internal val BeaconOnline = Color(0xFF047857)
internal val BeaconPrivacy = Color(0xFF7C3AED)
internal val BeaconWarning = Color(0xFFB45309)
internal val BeaconOffline = Color(0xFF64748B)
internal val BeaconCanvas = Color(0xFF09090B)
internal val BeaconActionBright = Color(0xFF60A5FA)
@OptIn(ExperimentalTextApi::class)
private val BeaconInter =
    FontFamily(
        Font(R.font.inter_variable, FontWeight.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(400))),
        Font(R.font.inter_variable, FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
        Font(R.font.inter_variable, FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(600))),
        Font(R.font.inter_variable, FontWeight.Bold, variationSettings = FontVariation.Settings(FontVariation.weight(700))),
        Font(R.font.inter_variable, FontWeight.ExtraBold, variationSettings = FontVariation.Settings(FontVariation.weight(800))),
    )

/** PWA type tokens (`--text-xs` through `--text-4xl`) mapped to Compose roles. */
internal val BeaconTypography =
    Typography(
        displayLarge = TextStyle(fontFamily = BeaconInter, fontSize = 36.sp, lineHeight = 38.sp, fontWeight = FontWeight.ExtraBold),
        headlineLarge = TextStyle(fontFamily = BeaconInter, fontSize = 30.sp, lineHeight = 34.sp, fontWeight = FontWeight.ExtraBold),
        headlineMedium = TextStyle(fontFamily = BeaconInter, fontSize = 24.sp, lineHeight = 29.sp, fontWeight = FontWeight.Bold),
        headlineSmall = TextStyle(fontFamily = BeaconInter, fontSize = 20.sp, lineHeight = 25.sp, fontWeight = FontWeight.Bold),
        titleLarge = TextStyle(fontFamily = BeaconInter, fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold),
        titleMedium = TextStyle(fontFamily = BeaconInter, fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
        titleSmall = TextStyle(fontFamily = BeaconInter, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontFamily = BeaconInter, fontSize = 15.sp, lineHeight = 22.sp),
        bodyMedium = TextStyle(fontFamily = BeaconInter, fontSize = 14.sp, lineHeight = 21.sp),
        bodySmall = TextStyle(fontFamily = BeaconInter, fontSize = 12.sp, lineHeight = 18.sp),
        labelLarge = TextStyle(fontFamily = BeaconInter, fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold),
        labelMedium = TextStyle(fontFamily = BeaconInter, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Bold),
        labelSmall = TextStyle(fontFamily = BeaconInter, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold),
    )

internal val BeaconShapes =
    Shapes(
        extraSmall = RoundedCornerShape(BeaconRadii.Sm),
        small = RoundedCornerShape(BeaconRadii.Md),
        medium = RoundedCornerShape(BeaconRadii.Lg),
        large = RoundedCornerShape(BeaconRadii.Lg),
        extraLarge = RoundedCornerShape(BeaconRadii.Lg),
    )

@Composable
internal fun BeaconPageHeader(
    eyebrow: String,
    title: String,
    modifier: Modifier = Modifier,
    supportingText: String? = null,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            eyebrow.uppercase(),
            color = MaterialTheme.colorScheme.primary,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        if (supportingText != null) {
            Text(
                supportingText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Matches the PWA's `.dash-empty` card (App.css): a dashed rather than
 * solid outline, used for the "nothing here yet" onboarding state. Plain
 * `Modifier.border` only draws solid strokes, so this dashes it manually. */
internal fun Modifier.beaconDashedBorder(
    color: Color,
    cornerRadius: Dp,
    strokeWidth: Dp = 1.dp,
): Modifier =
    drawBehind {
        val stroke = Stroke(
            width = strokeWidth.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(8.dp.toPx(), 6.dp.toPx()), 0f),
        )
        drawRoundRect(
            color = color,
            style = stroke,
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(cornerRadius.toPx()),
        )
    }

@Composable
internal fun BeaconPanel(
    modifier: Modifier = Modifier,
    contentPadding: Int = 18,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp)),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
    ) {
        Column(modifier = Modifier.padding(contentPadding.dp)) { content() }
    }
}

/** [onDark] is for pills drawn over live video or a dark screen: a solid dark backing, a light border and a lightened label. */
@Composable
internal fun BeaconStatusPill(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    onDark: Boolean = false,
) {
    val textColor = if (onDark) androidx.compose.ui.graphics.lerp(color, Color.White, 0.5f) else color
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(999.dp),
        color = if (onDark) Color(0xD9030B17) else color.copy(alpha = 0.14f),
        border = if (onDark) androidx.compose.foundation.BorderStroke(1.dp, Color(0x80FFFFFF)) else null,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(modifier = Modifier.size(7.dp).background(color, CircleShape))
            Text(label, color = textColor, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
internal fun BeaconTrustLine(
    text: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Icon(Icons.Outlined.Security, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

internal object BeaconRadii {
    val Sm = 4.dp
    val Md = 8.dp
    val Lg = 12.dp
    val Full = 999.dp
}
